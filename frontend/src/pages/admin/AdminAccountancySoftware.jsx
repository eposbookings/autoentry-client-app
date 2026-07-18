import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowRight,
  Activity,
  AlertTriangle,
  Banknote,
  BookOpen,
  Building2,
  CalendarCheck,
  CheckCircle2,
  ClipboardCheck,
  FileBarChart,
  Gauge,
  Landmark,
  MessageSquare,
  Plus,
  ReceiptText,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  Printer,
  Download,
  Upload,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";

const MODULES = [
  { key: "ai_workspace", label: "AI Workspace", icon: Sparkles },
  { key: "payables", label: "Payables", icon: ReceiptText },
  { key: "receivables", label: "Receivables", icon: WalletCards },
  { key: "banking", label: "Banking", icon: Banknote },
  { key: "vat", label: "VAT", icon: ShieldCheck },
  { key: "fixed_assets", label: "Fixed Assets", icon: Building2 },
  { key: "year_end", label: "Year End", icon: CalendarCheck },
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
  ai_workspace: {
    title: "AI Accounting Workspace",
    manage: ["My Work Queue", "Insights", "Exceptions", "Approvals", "Health Check"],
    statLabel: "Health score",
    stat: (workspace) => `${workspace?.ai_workspace?.health_check?.score ?? 0}/100`,
    tabs: ["Overview", "Tasks", "Insights", "Exceptions", "Approvals", "Deadlines", "Health Check", "AI Assistant", "Settings"],
  },
  payables: {
    title: "Accounts Payable",
    manage: ["Suppliers", "Purchase Invoices", "Credit Notes", "Supplier Payments"],
    statLabel: "Outstanding bills",
    stat: (workspace) => formatMoney(workspace?.accounts_payable?.dashboard?.outstanding_total || workspace?.summary?.ap_outstanding || 0),
    tabs: ["Dashboard", "Suppliers", "Purchase Invoices", "Credit Notes", "Payments", "Supplier Statements", "Aged Creditors", "Reports", "Settings"],
  },
  receivables: {
    title: "Accounts Receivable",
    manage: ["Customers", "Sales Invoices", "Credit Notes", "Receipts", "Aged Debtors"],
    statLabel: "Outstanding invoices",
    stat: (workspace) => formatMoney(workspace?.accounts_receivable?.dashboard?.outstanding_total || workspace?.summary?.ar_outstanding || workspace?.summary?.receivables || 0),
    tabs: ["Dashboard", "Customers", "Sales Invoices", "Credit Notes", "Receipts", "Customer Statements", "Aged Debtors", "Reports", "Settings"],
  },
  banking: {
    title: "Banking",
    manage: ["Bank Accounts", "Transactions", "Reconciliation", "Rules", "Transfers", "Cashbook"],
    statLabel: "Awaiting match",
    stat: (workspace) => workspace?.banking?.dashboard?.awaiting_match || workspace?.summary?.unreconciled_bank_transactions || 0,
    tabs: ["Dashboard", "Bank Accounts", "Transactions", "Reconciliation", "Bank Rules", "Transfers", "Cashbook", "Imported Statements", "Reports", "Settings"],
  },
  vat: {
    title: "VAT",
    manage: ["VAT Returns", "VAT Transactions", "VAT Codes", "VAT Periods", "Adjustments"],
    statLabel: "Net VAT due",
    stat: (workspace) => formatMoney(workspace?.vat_engine?.dashboard?.net_vat_due || 0),
    tabs: ["Dashboard", "VAT Returns", "VAT Transactions", "VAT Codes", "VAT Periods", "Adjustments", "Reports", "Settings"],
  },
  fixed_assets: {
    title: "Fixed Assets",
    manage: ["Asset Register", "Categories", "Depreciation", "Disposals", "Transfers", "Revaluations"],
    statLabel: "Net book value",
    stat: (workspace) => formatMoney(workspace?.fixed_assets?.dashboard?.net_book_value || 0),
    tabs: ["Dashboard", "Asset Register", "Asset Categories", "Depreciation", "Disposals", "Transfers", "Revaluations", "Reports", "Settings"],
  },
  year_end: {
    title: "Year End",
    manage: ["Period Close", "Financial Year Close", "Opening Balances", "Closing Journals", "Retained Earnings"],
    statLabel: "Open tasks",
    stat: (workspace) => workspace?.year_end?.dashboard?.outstanding_tasks || 0,
    tabs: ["Dashboard", "Period Close", "Financial Year Close", "Opening Balances", "Closing Journals", "Retained Earnings", "Lock History", "Reports", "Settings"],
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
    manage: ["Financial Statements", "Management Reports", "VAT Reports", "Sales Reports", "Purchase Reports", "Bank Reports"],
    statLabel: "Net profit",
    stat: (workspace) => formatMoney(workspace?.reports?.dashboard?.net_profit || workspace?.reports?.profit_and_loss?.profit),
    tabs: ["Dashboard", "Financial Statements", "Management Reports", "VAT Reports", "Sales Reports", "Purchase Reports", "Bank Reports", "Custom Reports", "Report Scheduler", "Exports", "Settings"],
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
          reloadWorkspace={async () => { await loadClients(); await loadWorkspace(workspace.client.id); }}
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
    reloadWorkspace,
    busy,
  } = props;
  const [filters, setFilters] = useState({ date_from: "", date_to: "", financial_year_id: "", period_id: "", search: "" });
  const detail = MODULE_DETAILS[module];

  function renderTab() {
    if (module === "ai_workspace") {
      return <AIAccountingWorkspace workspace={workspace} activeTab={moduleTab} />;
    }

    if (module === "payables") {
      return <AccountsPayableWorkspace workspace={workspace} tab={moduleTab} reloadWorkspace={reloadWorkspace} busy={busy} />;
    }

    if (module === "receivables") {
      return <AccountsReceivableWorkspace workspace={workspace} tab={moduleTab} reloadWorkspace={reloadWorkspace} busy={busy} />;
    }

    if (module === "banking") {
      return <BankingWorkspace workspace={workspace} tab={moduleTab} reloadWorkspace={reloadWorkspace} busy={busy} />;
    }

    if (module === "vat") {
      return <VatEngineWorkspace workspace={workspace} tab={moduleTab} reloadWorkspace={reloadWorkspace} busy={busy} />;
    }

    if (module === "fixed_assets") {
      return <FixedAssetsWorkspace workspace={workspace} tab={moduleTab} reloadWorkspace={reloadWorkspace} busy={busy} />;
    }

    if (module === "year_end") {
      return <YearEndWorkspace workspace={workspace} tab={moduleTab} reloadWorkspace={reloadWorkspace} busy={busy} />;
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

function BankReportLine({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-stone-600">{label}</span>
      <strong className="font-display text-stone-900">{value}</strong>
    </div>
  );
}

const EMPTY_AR_LINE = { description: "", nominal_account_code: "4000", quantity: "1", unit_price: "", discount_amount: "", net_amount: "", vat_amount: "", gross_amount: "", vat_code: "" };

function AccountsReceivableWorkspace({ workspace, tab, reloadWorkspace, busy }) {
  const ar = workspace.accounts_receivable || {};
  const customers = ar.customers || [];
  const invoices = ar.invoices || [];
  const creditNotes = ar.credit_notes || [];
  const receipts = ar.receipts || [];
  const accounts = workspace.accounts || [];
  const bankAccounts = accounts.filter((account) => account.purpose === "Bank Account" || account.account_type === "Bank");
  const incomeAccounts = accounts.filter((account) => account.category === "Income" || account.account_type === "Sales");
  const [saving, setSaving] = useState(false);
  const [customerQuery, setCustomerQuery] = useState("");
  const [statementCustomerId, setStatementCustomerId] = useState("");
  const emptyCustomerForm = { business_name: "", customer_code: "", trading_name: "", email: "", phone: "", website: "", vat_number: "", company_number: "", payment_terms_days: "30", default_currency: "GBP", default_sales_account: "4000", default_vat_code: "", credit_limit: "", notes: "" };
  const [customerForm, setCustomerForm] = useState(emptyCustomerForm);
  const [invoiceForm, setInvoiceForm] = useState({ customer_id: "", invoice_number: "", reference: "", invoice_date: "", due_date: "", currency: "GBP", lines: [{ ...EMPTY_AR_LINE }] });
  const [creditForm, setCreditForm] = useState({ customer_id: "", credit_note_number: "", reference: "", credit_note_date: "", currency: "GBP", lines: [{ ...EMPTY_AR_LINE }] });
  const [receiptForm, setReceiptForm] = useState({ customer_id: "", receipt_date: "", reference: "", payment_method: "Bank Transfer", bank_account_code: bankAccounts[0]?.code || "1200", amount: "", invoice_id: "" });
  const [settingsForm, setSettingsForm] = useState(ar.settings || {});

  useEffect(() => {
    setSettingsForm(ar.settings || {});
  }, [ar.settings]);

  const visibleCustomers = customers.filter((customer) => {
    const needle = customerQuery.trim().toLowerCase();
    if (!needle) return true;
    return `${customer.name || ""} ${customer.trading_name || ""} ${customer.customer_code || ""} ${customer.email || ""}`.toLowerCase().includes(needle);
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

  async function createCustomer(e) {
    e.preventDefault();
    if (!customerForm.business_name.trim()) return toast.error("Customer business name is required");
    await run(async () => postJson("/ar/customers", customerForm), "Customer created");
    setCustomerForm(emptyCustomerForm);
  }

  async function createInvoice(e) {
    e.preventDefault();
    if (!invoiceForm.customer_id) return toast.error("Customer is required");
    await run(async () => postJson("/ar/invoices", invoiceForm), "Sales invoice created");
    setInvoiceForm({ customer_id: "", invoice_number: "", reference: "", invoice_date: "", due_date: "", currency: "GBP", lines: [{ ...EMPTY_AR_LINE }] });
  }

  async function approveInvoice(invoice) {
    await run(async () => postJson(`/ar/invoices/${invoice.id}/approve`, {}), "Sales invoice approved");
  }

  async function postInvoice(invoice) {
    await run(async () => postJson(`/ar/invoices/${invoice.id}/post`, {}), "Sales invoice posted to the ledger");
  }

  async function archiveInvoice(invoice) {
    await run(async () => postJson(`/ar/invoices/${invoice.id}/archive`, {}), "Sales invoice archived");
  }

  async function createCreditNote(e) {
    e.preventDefault();
    if (!creditForm.customer_id || !creditForm.credit_note_number.trim()) return toast.error("Customer and credit note number are required");
    await run(async () => postJson("/ar/credit-notes", creditForm), "Customer credit note created");
    setCreditForm({ customer_id: "", credit_note_number: "", reference: "", credit_note_date: "", currency: "GBP", lines: [{ ...EMPTY_AR_LINE }] });
  }

  async function postCreditNote(creditNote) {
    await run(async () => postJson(`/ar/credit-notes/${creditNote.id}/post`, {}), "Customer credit note posted");
  }

  async function createReceipt(e) {
    e.preventDefault();
    if (!receiptForm.customer_id || !receiptForm.amount) return toast.error("Customer and receipt amount are required");
    const allocations = receiptForm.invoice_id ? [{ invoice_id: receiptForm.invoice_id, amount: receiptForm.amount }] : [];
    await run(async () => postJson("/ar/receipts", { ...receiptForm, allocations }), "Customer receipt posted");
    setReceiptForm({ customer_id: "", receipt_date: "", reference: "", payment_method: "Bank Transfer", bank_account_code: bankAccounts[0]?.code || "1200", amount: "", invoice_id: "" });
  }

  async function saveSettings(e) {
    e.preventDefault();
    await run(async () => putJson("/ar/settings", settingsForm), "Accounts Receivable settings saved");
  }

  if (tab === "Dashboard") {
    const dashboard = ar.dashboard || {};
    const salesSummary = ar.sales_summary || {};
    return (
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <SummaryCard label="Outstanding invoices" value={dashboard.outstanding_invoices || 0} tone="amber" />
          <SummaryCard label="Overdue invoices" value={dashboard.overdue_invoices || 0} tone="amber" />
          <SummaryCard label="Customers with balances" value={dashboard.customers_with_balances || 0} tone="blue" />
          <SummaryCard label="Receipts this month" value={formatMoney(dashboard.receipts_this_month)} tone="emerald" />
          <SummaryCard label="Average collection days" value={dashboard.average_collection_days || 0} tone="stone" />
          <SummaryCard label="Sales this month" value={formatMoney(dashboard.sales_this_month)} tone="emerald" />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Overdue invoices">
            {(ar.overdue_invoices || []).length === 0 ? <p className="py-8 text-center text-sm text-stone-500">No overdue invoices.</p> : (ar.overdue_invoices || []).slice(0, 8).map((invoice) => (
              <div key={invoice.id} className="flex items-center justify-between border-b border-stone-100 py-2 last:border-0">
                <div><strong>{invoice.customer_name}</strong><div className="text-xs text-stone-500">{invoice.invoice_number} - due {formatDate(invoice.due_date)}</div></div>
                <div className="text-right"><div className="font-semibold">{formatMoney(invoice.outstanding_amount)}</div><div className="text-xs text-amber-700">{invoice.days_overdue} days overdue</div></div>
              </div>
            ))}
          </Panel>
          <Panel title="Customers requiring attention">
            {(ar.customers_requiring_attention || []).length === 0 ? <p className="py-8 text-center text-sm text-stone-500">No customers need attention.</p> : (ar.customers_requiring_attention || []).slice(0, 8).map((customer) => (
              <div key={customer.customer_id} className="flex items-center justify-between border-b border-stone-100 py-2 last:border-0">
                <div><strong>{customer.customer_name}</strong><div className="text-xs text-stone-500">{(customer.reasons || []).join(", ")}</div></div>
                <strong>{formatMoney(customer.balance)}</strong>
              </div>
            ))}
          </Panel>
          <Panel title="Recent activity">
            {(ar.recent_activity || []).length === 0 ? <p className="py-8 text-center text-sm text-stone-500">No Accounts Receivable activity yet.</p> : (ar.recent_activity || []).slice(0, 10).map((item, index) => (
              <div key={`${item.type}-${item.description}-${index}`} className="flex items-center justify-between border-b border-stone-100 py-2 last:border-0">
                <div><strong>{item.type}</strong><div className="text-xs text-stone-500">{item.description || "-"} - {formatDateTime(item.date)}</div></div>
                {item.amount && <span>{formatMoney(item.amount)}</span>}
              </div>
            ))}
          </Panel>
          <Panel title="Sales summary">
            <div className="divide-y divide-stone-100">
              <BankReportLine label="Today" value={formatMoney(salesSummary.today)} />
              <BankReportLine label="This week" value={formatMoney(salesSummary.this_week)} />
              <BankReportLine label="This month" value={formatMoney(salesSummary.this_month)} />
              <BankReportLine label="Financial year" value={formatMoney(salesSummary.financial_year)} />
            </div>
          </Panel>
        </div>
      </div>
    );
  }

  if (tab === "Customers") {
    return (
      <div className="grid gap-4 xl:grid-cols-[1fr_390px]">
        <Panel title="Customer master file">
          <Input className="mb-3 h-9" value={customerQuery} onChange={(e) => setCustomerQuery(e.target.value)} placeholder="Search customers by name, code or email" />
          <div className="overflow-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                <tr><th className="px-3 py-2">Code</th><th className="px-3 py-2">Customer</th><th className="px-3 py-2">VAT</th><th className="px-3 py-2">Terms</th><th className="px-3 py-2">Credit limit</th><th className="px-3 py-2 text-right">Balance</th><th className="px-3 py-2">Status</th></tr>
              </thead>
              <tbody>
                {visibleCustomers.map((customer) => (
                  <tr key={customer.id} className="border-t border-stone-100">
                    <td className="px-3 py-2 text-stone-600">{customer.customer_code || "-"}</td>
                    <td className="px-3 py-2"><strong>{customer.name}</strong><div className="text-xs text-stone-500">{customer.email || customer.trading_name || "-"}</div></td>
                    <td className="px-3 py-2 text-stone-600">{customer.vat_number || "-"}</td>
                    <td className="px-3 py-2 text-stone-600">{customer.payment_terms_days || 0} days</td>
                    <td className="px-3 py-2 text-stone-600">{formatMoney(customer.credit_limit)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{formatMoney(customer.outstanding_balance)}</td>
                    <td className="px-3 py-2"><Badge className={customer.status === "active" ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-700"}>{customer.status || "active"}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Create customer">
          <form onSubmit={createCustomer} className="space-y-3">
            <Field label="Business name" value={customerForm.business_name} onChange={(value) => setCustomerForm((current) => ({ ...current, business_name: value }))} />
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
            <AccountCodeSelect label="Default sales account" accounts={incomeAccounts} value={customerForm.default_sales_account} onChange={(value) => setCustomerForm((current) => ({ ...current, default_sales_account: value }))} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Default VAT code" value={customerForm.default_vat_code} onChange={(value) => setCustomerForm((current) => ({ ...current, default_vat_code: value }))} />
              <Field label="Credit limit" value={customerForm.credit_limit} onChange={(value) => setCustomerForm((current) => ({ ...current, credit_limit: value }))} />
            </div>
            <Button disabled={busy || saving} className="w-full gap-2" style={{ background: "var(--brand)" }}><Plus className="h-4 w-4" /> Create customer</Button>
          </form>
        </Panel>
      </div>
    );
  }

  if (tab === "Sales Invoices") {
    return (
      <div className="grid gap-4 xl:grid-cols-[1fr_440px]">
        <ArRegister
          title="Sales invoices"
          rows={invoices}
          numberKey="invoice_number"
          dateKey="invoice_date"
          amountKey="gross_amount"
          empty="No sales invoices yet."
          actions={(invoice) => (
            <div className="flex justify-end gap-2">
              {invoice.status === "awaiting_approval" && <Button size="sm" variant="outline" disabled={saving} onClick={() => approveInvoice(invoice)}>Approve</Button>}
              {!invoice.posted_journal_id && (invoice.status === "approved" || !ar.settings?.approval_required) && <Button size="sm" disabled={saving} onClick={() => postInvoice(invoice)} style={{ background: "var(--brand)" }}>Post</Button>}
              {(invoice.status === "posted" || invoice.status === "paid" || invoice.status === "part_paid") && <Button size="sm" variant="outline" disabled={saving} onClick={() => archiveInvoice(invoice)}>Archive</Button>}
            </div>
          )}
        />
        <ArDocumentForm title="Create sales invoice" form={invoiceForm} setForm={setInvoiceForm} customers={customers} accounts={incomeAccounts} onSubmit={createInvoice} button="Create invoice" busy={busy || saving} numberKey="invoice_number" dateKey="invoice_date" />
      </div>
    );
  }

  if (tab === "Credit Notes") {
    return (
      <div className="grid gap-4 xl:grid-cols-[1fr_440px]">
        <ArRegister
          title="Customer credit notes"
          rows={creditNotes}
          numberKey="credit_note_number"
          dateKey="credit_note_date"
          amountKey="gross_amount"
          empty="No customer credit notes yet."
          actions={(creditNote) => !creditNote.posted_journal_id && <Button size="sm" disabled={saving} onClick={() => postCreditNote(creditNote)} style={{ background: "var(--brand)" }}>Post</Button>}
        />
        <ArDocumentForm title="Create customer credit note" form={creditForm} setForm={setCreditForm} customers={customers} accounts={incomeAccounts} onSubmit={createCreditNote} button="Create credit note" busy={busy || saving} numberKey="credit_note_number" dateKey="credit_note_date" />
      </div>
    );
  }

  if (tab === "Receipts") {
    const customerInvoices = invoices.filter((invoice) => invoice.customer_id === receiptForm.customer_id && Number(invoice.outstanding_amount || 0) > 0);
    return (
      <div className="grid gap-4 xl:grid-cols-[1fr_390px]">
        <ArRegister title="Customer receipts" rows={receipts} numberKey="reference" dateKey="receipt_date" amountKey="amount" empty="No customer receipts yet." />
        <Panel title="Receive money">
          <form onSubmit={createReceipt} className="space-y-3">
            <CustomerSelect customers={customers} value={receiptForm.customer_id} onChange={(value) => setReceiptForm((current) => ({ ...current, customer_id: value, invoice_id: "" }))} />
            <Field label="Receipt date" type="date" value={receiptForm.receipt_date} onChange={(value) => setReceiptForm((current) => ({ ...current, receipt_date: value }))} />
            <Field label="Reference" value={receiptForm.reference} onChange={(value) => setReceiptForm((current) => ({ ...current, reference: value }))} />
            <SelectField label="Payment method" value={receiptForm.payment_method} onChange={(value) => setReceiptForm((current) => ({ ...current, payment_method: value }))} options={["Bank Transfer", "Card", "Cash", "Cheque", "Direct Debit"]} />
            <AccountCodeSelect label="Bank account" accounts={bankAccounts} value={receiptForm.bank_account_code} onChange={(value) => setReceiptForm((current) => ({ ...current, bank_account_code: value }))} />
            <div>
              <Label className="text-xs font-semibold text-stone-600">Allocate to invoice</Label>
              <select value={receiptForm.invoice_id} onChange={(e) => {
                const invoice = invoices.find((item) => item.id === e.target.value);
                setReceiptForm((current) => ({ ...current, invoice_id: e.target.value, amount: invoice?.outstanding_amount || current.amount }));
              }} className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm">
                <option value="">Oldest invoices automatically</option>
                {customerInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoice_number} - {formatMoney(invoice.outstanding_amount)}</option>)}
              </select>
            </div>
            <Field label="Amount" value={receiptForm.amount} onChange={(value) => setReceiptForm((current) => ({ ...current, amount: value }))} />
            <Button disabled={busy || saving} className="w-full" style={{ background: "var(--brand)" }}>Post receipt</Button>
          </form>
        </Panel>
      </div>
    );
  }

  if (tab === "Customer Statements") {
    const rows = statementCustomerId ? arStatementRows(statementCustomerId, invoices, creditNotes, receipts) : [];
    return (
      <Panel title="Customer statement">
        <div className="mb-3 max-w-lg"><CustomerSelect customers={customers} value={statementCustomerId} onChange={setStatementCustomerId} /></div>
        {rows.length === 0 ? <p className="py-8 text-center text-sm text-stone-500">Select a customer to view statement activity.</p> : (
          <div className="overflow-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Reference</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th><th className="px-3 py-2 text-right">Balance</th></tr></thead>
              <tbody>{rows.map((row, index) => <tr key={`${row.type}-${row.id}-${index}`} className="border-t border-stone-100"><td className="px-3 py-2">{formatDate(row.date)}</td><td className="px-3 py-2">{row.type}</td><td className="px-3 py-2">{row.reference}</td><td className="px-3 py-2 text-right">{row.debit ? formatMoney(row.debit) : "-"}</td><td className="px-3 py-2 text-right">{row.credit ? formatMoney(row.credit) : "-"}</td><td className="px-3 py-2 text-right font-semibold">{formatMoney(row.balance)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </Panel>
    );
  }

  if (tab === "Aged Debtors") {
    return <AgedDebtorsTable rows={ar.aged_debtors || []} />;
  }

  if (tab === "Reports") {
    return <ArReports ar={ar} />;
  }

  if (tab === "Settings") {
    return (
      <Panel title="Accounts Receivable settings">
        <form onSubmit={saveSettings} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="flex items-center gap-2 rounded-md border border-stone-200 p-3 text-sm font-semibold text-stone-700"><input type="checkbox" checked={!!settingsForm.approval_required} onChange={(e) => setSettingsForm((current) => ({ ...current, approval_required: e.target.checked }))} /> Approval required</label>
          <label className="flex items-center gap-2 rounded-md border border-stone-200 p-3 text-sm font-semibold text-stone-700"><input type="checkbox" checked={!!settingsForm.duplicate_invoice_warning} onChange={(e) => setSettingsForm((current) => ({ ...current, duplicate_invoice_warning: e.target.checked }))} /> Duplicate invoice warning</label>
          <label className="flex items-center gap-2 rounded-md border border-stone-200 p-3 text-sm font-semibold text-stone-700"><input type="checkbox" checked={!!settingsForm.credit_limit_warnings} onChange={(e) => setSettingsForm((current) => ({ ...current, credit_limit_warnings: e.target.checked }))} /> Credit limit warnings</label>
          <label className="flex items-center gap-2 rounded-md border border-stone-200 p-3 text-sm font-semibold text-stone-700"><input type="checkbox" checked={!!settingsForm.automatic_customer_numbering} onChange={(e) => setSettingsForm((current) => ({ ...current, automatic_customer_numbering: e.target.checked }))} /> Automatic customer numbering</label>
          <Field label="Default terms days" value={settingsForm.default_payment_terms_days} onChange={(value) => setSettingsForm((current) => ({ ...current, default_payment_terms_days: value }))} />
          <AccountCodeSelect label="Default sales nominal" accounts={incomeAccounts} value={settingsForm.default_sales_account} onChange={(value) => setSettingsForm((current) => ({ ...current, default_sales_account: value }))} />
          <Field label="Default VAT code" value={settingsForm.default_vat_code} onChange={(value) => setSettingsForm((current) => ({ ...current, default_vat_code: value }))} />
          <Field label="Invoice prefix" value={settingsForm.invoice_number_prefix} onChange={(value) => setSettingsForm((current) => ({ ...current, invoice_number_prefix: value }))} />
          <Field label="Next invoice number" value={settingsForm.next_invoice_number} onChange={(value) => setSettingsForm((current) => ({ ...current, next_invoice_number: value }))} />
          <div className="md:col-span-2 xl:col-span-4"><Button disabled={busy || saving} style={{ background: "var(--brand)" }}>Save AR settings</Button></div>
        </form>
      </Panel>
    );
  }

  return null;
}

function ArDocumentForm({ title, form, setForm, customers, accounts, onSubmit, button, busy, numberKey, dateKey }) {
  const updateLine = (index, key, value) => setForm((current) => ({ ...current, lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, [key]: value } : line) }));
  const totals = apFormTotals(form.lines || []);
  return (
    <Panel title={title}>
      <form onSubmit={onSubmit} className="space-y-3">
        <CustomerSelect customers={customers} value={form.customer_id} onChange={(value) => setForm((current) => ({ ...current, customer_id: value }))} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Number" value={form[numberKey]} onChange={(value) => setForm((current) => ({ ...current, [numberKey]: value }))} />
          <Field label="Reference" value={form.reference} onChange={(value) => setForm((current) => ({ ...current, reference: value }))} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Date" type="date" value={form[dateKey]} onChange={(value) => setForm((current) => ({ ...current, [dateKey]: value }))} />
          {form.due_date !== undefined && <Field label="Due date" type="date" value={form.due_date} onChange={(value) => setForm((current) => ({ ...current, due_date: value }))} />}
        </div>
        <div className="rounded-md border border-stone-200">
          <div className="border-b border-stone-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Lines</div>
          {(form.lines || []).map((line, index) => (
            <div key={index} className="grid gap-2 border-b border-stone-100 p-3 last:border-b-0">
              <Field label="Description" value={line.description} onChange={(value) => updateLine(index, "description", value)} />
              <AccountCodeSelect label="Sales nominal" accounts={accounts} value={line.nominal_account_code} onChange={(value) => updateLine(index, "nominal_account_code", value)} />
              <div className="grid grid-cols-4 gap-2">
                <Field label="Qty" value={line.quantity} onChange={(value) => updateLine(index, "quantity", value)} />
                <Field label="Unit price" value={line.unit_price} onChange={(value) => updateLine(index, "unit_price", value)} />
                <Field label="Discount" value={line.discount_amount} onChange={(value) => updateLine(index, "discount_amount", value)} />
                <Field label="VAT code" value={line.vat_code} onChange={(value) => updateLine(index, "vat_code", value)} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Net" value={line.net_amount} onChange={(value) => updateLine(index, "net_amount", value)} />
                <Field label="VAT" value={line.vat_amount} onChange={(value) => updateLine(index, "vat_amount", value)} />
                <Field label="Gross" value={line.gross_amount} onChange={(value) => updateLine(index, "gross_amount", value)} />
              </div>
              {(form.lines || []).length > 1 && <Button type="button" variant="outline" size="sm" onClick={() => setForm((current) => ({ ...current, lines: current.lines.filter((_, lineIndex) => lineIndex !== index) }))}>Remove line</Button>}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap justify-between gap-2 rounded-md bg-stone-50 p-3 text-sm">
          <span>Net: <strong>{formatMoney(totals.net)}</strong></span>
          <span>VAT: <strong>{formatMoney(totals.vat)}</strong></span>
          <span>Gross: <strong>{formatMoney(totals.gross)}</strong></span>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => setForm((current) => ({ ...current, lines: [...current.lines, { ...EMPTY_AR_LINE }] }))}>Add line</Button>
          <Button disabled={busy} style={{ background: "var(--brand)" }} className="flex-1">{button}</Button>
        </div>
      </form>
    </Panel>
  );
}

function ArRegister({ title, rows = [], numberKey, dateKey, amountKey, empty, actions }) {
  return (
    <Panel title={title}>
      {rows.length === 0 ? <p className="py-10 text-center text-sm text-stone-500">{empty}</p> : (
        <div className="overflow-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Customer</th><th className="px-3 py-2">Reference</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Due</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Net</th><th className="px-3 py-2 text-right">VAT</th><th className="px-3 py-2 text-right">Gross</th><th className="px-3 py-2 text-right">Outstanding</th><th className="px-3 py-2"></th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-stone-100 align-top">
                  <td className="px-3 py-2 font-semibold text-stone-900">{row.customer_name || "-"}</td>
                  <td className="px-3 py-2">{row[numberKey] || row.reference || "-"}</td>
                  <td className="px-3 py-2">{formatDate(row[dateKey])}</td>
                  <td className="px-3 py-2">{formatDate(row.due_date)}</td>
                  <td className="px-3 py-2"><Badge className={apStatusClass(row.status)}>{row.status}</Badge></td>
                  <td className="px-3 py-2 text-right">{formatMoney(row.net_amount)}</td>
                  <td className="px-3 py-2 text-right">{formatMoney(row.vat_amount)}</td>
                  <td className="px-3 py-2 text-right">{formatMoney(row[amountKey])}</td>
                  <td className="px-3 py-2 text-right">{row.outstanding_amount ? formatMoney(row.outstanding_amount) : row.unallocated_amount ? formatMoney(row.unallocated_amount) : "-"}</td>
                  <td className="px-3 py-2">{actions?.(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function CustomerSelect({ customers, value, onChange }) {
  return (
    <div>
      <Label className="text-xs font-semibold text-stone-600">Customer</Label>
      <select value={value || ""} onChange={(e) => onChange(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm">
        <option value="">Select customer</option>
        {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
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
      <ArRegister title="Outstanding invoices" rows={unpaid} numberKey="invoice_number" dateKey="invoice_date" amountKey="gross_amount" empty="No outstanding invoices." />
    </div>
  );
}

function arStatementRows(customerId, invoices, creditNotes, receipts) {
  let balance = 0;
  return [
    ...invoices.filter((item) => item.customer_id === customerId).map((item) => ({ id: item.id, date: item.invoice_date, type: "Invoice", reference: item.invoice_number, debit: Number(item.gross_amount || 0), credit: 0 })),
    ...creditNotes.filter((item) => item.customer_id === customerId).map((item) => ({ id: item.id, date: item.credit_note_date, type: "Credit note", reference: item.credit_note_number, debit: 0, credit: Number(item.gross_amount || 0) })),
    ...receipts.filter((item) => item.customer_id === customerId).map((item) => ({ id: item.id, date: item.receipt_date, type: "Receipt", reference: item.reference, debit: 0, credit: Number(item.amount || 0) })),
  ].sort((a, b) => String(a.date || "").localeCompare(String(b.date || ""))).map((row) => {
    balance += row.debit - row.credit;
    return { ...row, balance };
  });
}

const EMPTY_AP_LINE = { description: "", nominal_account_code: "5000", quantity: "1", unit_price: "", net_amount: "", vat_amount: "", gross_amount: "", vat_code: "" };

function AccountsPayableWorkspace({ workspace, tab, reloadWorkspace, busy }) {
  const ap = workspace.accounts_payable || {};
  const suppliers = ap.suppliers || [];
  const invoices = ap.invoices || [];
  const creditNotes = ap.credit_notes || [];
  const payments = ap.payments || [];
  const accounts = workspace.accounts || [];
  const bankAccounts = accounts.filter((account) => account.purpose === "Bank Account" || account.account_type === "Bank");
  const expenseAccounts = accounts.filter((account) => account.category === "Expense" || account.account_type === "Purchases" || account.account_type === "Overheads");
  const [saving, setSaving] = useState(false);
  const [supplierQuery, setSupplierQuery] = useState("");
  const [statementSupplierId, setStatementSupplierId] = useState("");
  const emptySupplierForm = { name: "", supplier_code: "", email: "", phone: "", website: "", vat_number: "", company_number: "", payment_terms_days: "30", default_currency: "GBP", default_purchase_account: "5000", default_vat_code: "", bank_name: "", bank_sort_code: "", bank_account_number: "", cis_registered: false, reverse_charge: false, notes: "" };
  const [supplierForm, setSupplierForm] = useState(emptySupplierForm);
  const [invoiceForm, setInvoiceForm] = useState({ supplier_id: "", invoice_number: "", reference: "", invoice_date: "", due_date: "", currency: "GBP", lines: [{ ...EMPTY_AP_LINE }] });
  const [creditForm, setCreditForm] = useState({ supplier_id: "", credit_note_number: "", reference: "", credit_note_date: "", currency: "GBP", lines: [{ ...EMPTY_AP_LINE }] });
  const [paymentForm, setPaymentForm] = useState({ supplier_id: "", payment_date: "", reference: "", bank_account_code: bankAccounts[0]?.code || "1200", amount: "", invoice_id: "" });
  const [settingsForm, setSettingsForm] = useState(ap.settings || {});

  useEffect(() => {
    setSettingsForm(ap.settings || {});
  }, [ap.settings]);

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

  async function createInvoice(e) {
    e.preventDefault();
    if (!invoiceForm.supplier_id || !invoiceForm.invoice_number.trim()) return toast.error("Supplier and invoice number are required");
    await run(async () => postJson("/ap/invoices", invoiceForm), "Purchase invoice created");
    setInvoiceForm({ supplier_id: "", invoice_number: "", reference: "", invoice_date: "", due_date: "", currency: "GBP", lines: [{ ...EMPTY_AP_LINE }] });
  }

  async function approveInvoice(invoice) {
    await run(async () => postJson(`/ap/invoices/${invoice.id}/approve`, {}), "Purchase invoice approved");
  }

  async function postInvoice(invoice) {
    await run(async () => postJson(`/ap/invoices/${invoice.id}/post`, {}), "Purchase invoice posted to the ledger");
  }

  async function voidInvoice(invoice) {
    await run(async () => postJson(`/ap/invoices/${invoice.id}/void`, {}), "Purchase invoice voided");
  }

  async function createCreditNote(e) {
    e.preventDefault();
    if (!creditForm.supplier_id || !creditForm.credit_note_number.trim()) return toast.error("Supplier and credit note number are required");
    await run(async () => postJson("/ap/credit-notes", creditForm), "Supplier credit note created");
    setCreditForm({ supplier_id: "", credit_note_number: "", reference: "", credit_note_date: "", currency: "GBP", lines: [{ ...EMPTY_AP_LINE }] });
  }

  async function postCreditNote(creditNote) {
    await run(async () => postJson(`/ap/credit-notes/${creditNote.id}/post`, {}), "Supplier credit note posted");
  }

  async function createPayment(e) {
    e.preventDefault();
    if (!paymentForm.supplier_id || !paymentForm.amount) return toast.error("Supplier and payment amount are required");
    const allocations = paymentForm.invoice_id ? [{ invoice_id: paymentForm.invoice_id, amount: paymentForm.amount }] : [];
    await run(async () => postJson("/ap/payments", { ...paymentForm, allocations }), "Supplier payment posted");
    setPaymentForm({ supplier_id: "", payment_date: "", reference: "", bank_account_code: bankAccounts[0]?.code || "1200", amount: "", invoice_id: "" });
  }

  async function saveSettings(e) {
    e.preventDefault();
    await run(async () => putJson("/ap/settings", settingsForm), "Accounts Payable settings saved");
  }

  if (tab === "Dashboard") {
    const dashboard = ap.dashboard || {};
    const recent = [...invoices.slice(0, 4).map((item) => ({ ...item, kind: "Invoice" })), ...payments.slice(0, 4).map((item) => ({ ...item, kind: "Payment" }))].slice(0, 6);
    return (
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Outstanding bills" value={formatMoney(dashboard.outstanding_total)} tone="amber" />
          <SummaryCard label="Overdue bills" value={dashboard.overdue_invoices || 0} tone="amber" />
          <SummaryCard label="Awaiting approval" value={dashboard.awaiting_approval || 0} tone="blue" />
          <SummaryCard label="Payments posted" value={formatMoney(dashboard.payments_total)} tone="emerald" />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Top suppliers">
            {suppliers.filter((supplier) => Number(supplier.balance || 0) !== 0).slice(0, 8).map((supplier) => (
              <div key={supplier.id} className="flex items-center justify-between border-b border-stone-100 py-2 last:border-0">
                <span className="font-semibold text-stone-900">{supplier.name}</span>
                <span>{formatMoney(supplier.balance)}</span>
              </div>
            ))}
            {!suppliers.some((supplier) => Number(supplier.balance || 0) !== 0) && <p className="py-8 text-center text-sm text-stone-500">No supplier balances yet.</p>}
          </Panel>
          <Panel title="Recent activity">
            {recent.length === 0 ? <p className="py-8 text-center text-sm text-stone-500">No Accounts Payable activity yet.</p> : recent.map((item) => (
              <div key={`${item.kind}-${item.id}`} className="flex items-center justify-between border-b border-stone-100 py-2 last:border-0">
                <div>
                  <div className="font-semibold text-stone-900">{item.kind} {item.invoice_number || item.reference || item.credit_note_number}</div>
                  <div className="text-xs text-stone-500">{item.supplier_name || "-"} - {formatDate(item.invoice_date || item.payment_date || item.credit_note_date)}</div>
                </div>
                <Badge className={apStatusClass(item.status)}>{item.status}</Badge>
              </div>
            ))}
          </Panel>
        </div>
      </div>
    );
  }

  if (tab === "Suppliers") {
    return (
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Panel title="Supplier master file">
          <Input className="mb-3 h-9" value={supplierQuery} onChange={(e) => setSupplierQuery(e.target.value)} placeholder="Search suppliers by name, code or email" />
          <div className="overflow-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                <tr><th className="px-3 py-2">Code</th><th className="px-3 py-2">Supplier</th><th className="px-3 py-2">VAT</th><th className="px-3 py-2">Terms</th><th className="px-3 py-2">Default account</th><th className="px-3 py-2 text-right">Balance</th></tr>
              </thead>
              <tbody>
                {visibleSuppliers.map((supplier) => (
                  <tr key={supplier.id} className="border-t border-stone-100">
                    <td className="px-3 py-2 text-stone-600">{supplier.supplier_code || "-"}</td>
                    <td className="px-3 py-2"><strong>{supplier.name}</strong><div className="text-xs text-stone-500">{supplier.email || supplier.trading_name || "-"}</div></td>
                    <td className="px-3 py-2 text-stone-600">{supplier.vat_number || "-"}</td>
                    <td className="px-3 py-2 text-stone-600">{supplier.payment_terms_days || 0} days</td>
                    <td className="px-3 py-2 text-stone-600">{supplier.default_purchase_account || "-"}</td>
                    <td className="px-3 py-2 text-right font-semibold">{formatMoney(supplier.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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

  if (tab === "Purchase Invoices") {
    return (
      <div className="grid gap-4 xl:grid-cols-[1fr_430px]">
        <ApRegister
          title="Purchase invoices"
          rows={invoices}
          numberKey="invoice_number"
          dateKey="invoice_date"
          amountKey="gross_amount"
          empty="No purchase invoices yet."
          actions={(invoice) => (
            <div className="flex justify-end gap-2">
              {invoice.status === "awaiting_approval" && <Button size="sm" variant="outline" disabled={saving} onClick={() => approveInvoice(invoice)}>Approve</Button>}
              {!invoice.posted_journal_id && (invoice.status === "approved" || !ap.settings?.approval_required) && <Button size="sm" disabled={saving} onClick={() => postInvoice(invoice)} style={{ background: "var(--brand)" }}>Post</Button>}
              {!invoice.posted_journal_id && invoice.status !== "void" && <Button size="sm" variant="outline" disabled={saving} onClick={() => voidInvoice(invoice)}>Void</Button>}
            </div>
          )}
        />
        <ApDocumentForm title="Create purchase invoice" form={invoiceForm} setForm={setInvoiceForm} suppliers={suppliers} accounts={expenseAccounts} onSubmit={createInvoice} button="Create invoice" busy={busy || saving} numberKey="invoice_number" dateKey="invoice_date" />
      </div>
    );
  }

  if (tab === "Credit Notes") {
    return (
      <div className="grid gap-4 xl:grid-cols-[1fr_430px]">
        <ApRegister
          title="Supplier credit notes"
          rows={creditNotes}
          numberKey="credit_note_number"
          dateKey="credit_note_date"
          amountKey="gross_amount"
          empty="No supplier credit notes yet."
          actions={(creditNote) => !creditNote.posted_journal_id && <Button size="sm" disabled={saving} onClick={() => postCreditNote(creditNote)} style={{ background: "var(--brand)" }}>Post</Button>}
        />
        <ApDocumentForm title="Create supplier credit note" form={creditForm} setForm={setCreditForm} suppliers={suppliers} accounts={expenseAccounts} onSubmit={createCreditNote} button="Create credit note" busy={busy || saving} numberKey="credit_note_number" dateKey="credit_note_date" />
      </div>
    );
  }

  if (tab === "Payments") {
    const supplierInvoices = invoices.filter((invoice) => invoice.supplier_id === paymentForm.supplier_id && Number(invoice.outstanding_amount || 0) > 0);
    return (
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <ApRegister title="Supplier payments" rows={payments} numberKey="reference" dateKey="payment_date" amountKey="amount" empty="No supplier payments yet." />
        <Panel title="Pay supplier">
          <form onSubmit={createPayment} className="space-y-3">
            <SupplierSelect suppliers={suppliers} value={paymentForm.supplier_id} onChange={(value) => setPaymentForm((current) => ({ ...current, supplier_id: value, invoice_id: "" }))} />
            <Field label="Payment date" type="date" value={paymentForm.payment_date} onChange={(value) => setPaymentForm((current) => ({ ...current, payment_date: value }))} />
            <Field label="Reference" value={paymentForm.reference} onChange={(value) => setPaymentForm((current) => ({ ...current, reference: value }))} />
            <AccountCodeSelect label="Bank account" accounts={bankAccounts} value={paymentForm.bank_account_code} onChange={(value) => setPaymentForm((current) => ({ ...current, bank_account_code: value }))} />
            <div>
              <Label className="text-xs font-semibold text-stone-600">Allocate to invoice</Label>
              <select value={paymentForm.invoice_id} onChange={(e) => {
                const invoice = invoices.find((item) => item.id === e.target.value);
                setPaymentForm((current) => ({ ...current, invoice_id: e.target.value, amount: invoice?.outstanding_amount || current.amount }));
              }} className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm">
                <option value="">Oldest invoices automatically</option>
                {supplierInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoice_number} - {formatMoney(invoice.outstanding_amount)}</option>)}
              </select>
            </div>
            <Field label="Amount" value={paymentForm.amount} onChange={(value) => setPaymentForm((current) => ({ ...current, amount: value }))} />
            <Button disabled={busy || saving} className="w-full" style={{ background: "var(--brand)" }}>Post payment</Button>
          </form>
        </Panel>
      </div>
    );
  }

  if (tab === "Supplier Statements") {
    const rows = statementSupplierId ? statementRows(statementSupplierId, invoices, creditNotes, payments) : [];
    return (
      <Panel title="Supplier statement">
        <div className="mb-3 max-w-lg"><SupplierSelect suppliers={suppliers} value={statementSupplierId} onChange={setStatementSupplierId} /></div>
        {rows.length === 0 ? <p className="py-8 text-center text-sm text-stone-500">Select a supplier to view statement activity.</p> : (
          <div className="overflow-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Reference</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th><th className="px-3 py-2 text-right">Balance</th></tr></thead>
              <tbody>{rows.map((row, index) => <tr key={`${row.type}-${row.id}-${index}`} className="border-t border-stone-100"><td className="px-3 py-2">{formatDate(row.date)}</td><td className="px-3 py-2">{row.type}</td><td className="px-3 py-2">{row.reference}</td><td className="px-3 py-2 text-right">{row.debit ? formatMoney(row.debit) : "-"}</td><td className="px-3 py-2 text-right">{row.credit ? formatMoney(row.credit) : "-"}</td><td className="px-3 py-2 text-right font-semibold">{formatMoney(row.balance)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </Panel>
    );
  }

  if (tab === "Aged Creditors") {
    return <AgedCreditorsTable rows={ap.aged_creditors || []} />;
  }

  if (tab === "Reports") {
    return <ApReports ap={ap} />;
  }

  if (tab === "Settings") {
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
          <div className="md:col-span-2 xl:col-span-4"><Button disabled={busy || saving} style={{ background: "var(--brand)" }}>Save AP settings</Button></div>
        </form>
      </Panel>
    );
  }

  return null;
}

function ApDocumentForm({ title, form, setForm, suppliers, accounts, onSubmit, button, busy, numberKey, dateKey }) {
  const updateLine = (index, key, value) => setForm((current) => ({ ...current, lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, [key]: value } : line) }));
  const totals = apFormTotals(form.lines || []);
  return (
    <Panel title={title}>
      <form onSubmit={onSubmit} className="space-y-3">
        <SupplierSelect suppliers={suppliers} value={form.supplier_id} onChange={(value) => setForm((current) => ({ ...current, supplier_id: value }))} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Number" value={form[numberKey]} onChange={(value) => setForm((current) => ({ ...current, [numberKey]: value }))} />
          <Field label="Reference" value={form.reference} onChange={(value) => setForm((current) => ({ ...current, reference: value }))} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Date" type="date" value={form[dateKey]} onChange={(value) => setForm((current) => ({ ...current, [dateKey]: value }))} />
          {form.due_date !== undefined && <Field label="Due date" type="date" value={form.due_date} onChange={(value) => setForm((current) => ({ ...current, due_date: value }))} />}
        </div>
        <div className="rounded-md border border-stone-200">
          <div className="border-b border-stone-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Lines</div>
          {(form.lines || []).map((line, index) => (
            <div key={index} className="grid gap-2 border-b border-stone-100 p-3 last:border-b-0">
              <Field label="Description" value={line.description} onChange={(value) => updateLine(index, "description", value)} />
              <AccountCodeSelect label="Nominal account" accounts={accounts} value={line.nominal_account_code} onChange={(value) => updateLine(index, "nominal_account_code", value)} />
              <div className="grid grid-cols-3 gap-2">
                <Field label="Net" value={line.net_amount} onChange={(value) => updateLine(index, "net_amount", value)} />
                <Field label="VAT" value={line.vat_amount} onChange={(value) => updateLine(index, "vat_amount", value)} />
                <Field label="Gross" value={line.gross_amount} onChange={(value) => updateLine(index, "gross_amount", value)} />
              </div>
              <Field label="VAT code" value={line.vat_code} onChange={(value) => updateLine(index, "vat_code", value)} />
              {(form.lines || []).length > 1 && <Button type="button" variant="outline" size="sm" onClick={() => setForm((current) => ({ ...current, lines: current.lines.filter((_, lineIndex) => lineIndex !== index) }))}>Remove line</Button>}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap justify-between gap-2 rounded-md bg-stone-50 p-3 text-sm">
          <span>Net: <strong>{formatMoney(totals.net)}</strong></span>
          <span>VAT: <strong>{formatMoney(totals.vat)}</strong></span>
          <span>Gross: <strong>{formatMoney(totals.gross)}</strong></span>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => setForm((current) => ({ ...current, lines: [...current.lines, { ...EMPTY_AP_LINE }] }))}>Add line</Button>
          <Button disabled={busy} style={{ background: "var(--brand)" }} className="flex-1">{button}</Button>
        </div>
      </form>
    </Panel>
  );
}

function ApRegister({ title, rows, numberKey, dateKey, amountKey, empty, actions }) {
  return (
    <Panel title={title}>
      {rows.length === 0 ? <p className="py-10 text-center text-sm text-stone-500">{empty}</p> : (
        <div className="overflow-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Supplier</th><th className="px-3 py-2">Reference</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-right">Outstanding</th><th className="px-3 py-2"></th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-stone-100 align-top">
                  <td className="px-3 py-2 font-semibold text-stone-900">{row.supplier_name || "-"}</td>
                  <td className="px-3 py-2">{row[numberKey] || row.reference || "-"}</td>
                  <td className="px-3 py-2">{formatDate(row[dateKey])}</td>
                  <td className="px-3 py-2"><Badge className={apStatusClass(row.status)}>{row.status}</Badge></td>
                  <td className="px-3 py-2 text-right">{formatMoney(row[amountKey])}</td>
                  <td className="px-3 py-2 text-right">{row.outstanding_amount ? formatMoney(row.outstanding_amount) : row.unallocated_amount ? formatMoney(row.unallocated_amount) : "-"}</td>
                  <td className="px-3 py-2">{actions?.(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
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

function YearEndWorkspace({ workspace, tab, reloadWorkspace, busy }) {
  const clientId = workspace?.client?.id;
  const data = workspace?.year_end || {};
  const dashboard = data.dashboard || {};
  const checklist = data.checklist || {};
  const settings = useMemo(() => data.settings || {}, [data.settings]);
  const accounts = Array.isArray(workspace?.accounts) ? workspace.accounts : [];
  const periods = Array.isArray(data.periods) ? data.periods : [];
  const years = Array.isArray(data.financial_years) ? data.financial_years : [];
  const openingPreview = Array.isArray(data.opening_balance_preview) ? data.opening_balance_preview : [];
  const openingBalances = Array.isArray(data.opening_balances) ? data.opening_balances : [];
  const closingJournals = Array.isArray(data.closing_journals) ? data.closing_journals : [];
  const history = Array.isArray(data.lock_history) ? data.lock_history : [];
  const reports = data.reports || {};
  const [saving, setSaving] = useState(false);
  const [periodReason, setPeriodReason] = useState("");
  const [closeReason, setCloseReason] = useState("");
  const [settingsForm, setSettingsForm] = useState(settings);
  const [journalForm, setJournalForm] = useState({
    entry_date: "",
    reference: "YE-ADJ",
    description: "Year-end adjustment",
    reason: "",
    lines: [
      { account_code: "", debit: "", credit: "", description: "" },
      { account_code: "", debit: "", credit: "", description: "" },
    ],
  });

  useEffect(() => {
    setSettingsForm(settings || {});
  }, [settings]);

  async function runAction(label, fn) {
    setSaving(true);
    try {
      await fn();
      toast.success(label);
      await reloadWorkspace?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  }

  function periodAction(period, action) {
    return runAction(`Period ${action} complete`, () => api.post(`/admin/accounting/clients/${clientId}/year-end/periods/${period.id}/${action}`, { reason: periodReason }));
  }

  function closeYear(year) {
    if (!year?.id) return;
    return runAction("Financial year closed", () => api.post(`/admin/accounting/clients/${clientId}/year-end/financial-years/${year.id}/close`, { reason: closeReason }));
  }

  function reopenYear(year) {
    if (!year?.id) return;
    return runAction("Financial year reopened", () => api.post(`/admin/accounting/clients/${clientId}/year-end/financial-years/${year.id}/reopen`, { reason: closeReason }));
  }

  function saveSettings(e) {
    e.preventDefault();
    return runAction("Year-end settings saved", () => api.put(`/admin/accounting/clients/${clientId}/year-end/settings`, settingsForm));
  }

  function postAdjustment(e) {
    e.preventDefault();
    const lines = journalForm.lines.filter((line) => line.account_code && (line.debit || line.credit));
    return runAction("Year-end adjustment posted", () => api.post(`/admin/accounting/clients/${clientId}/year-end/journals`, { ...journalForm, lines }));
  }

  const currentYear = data.current_year || years[0] || null;
  const checklistItems = Array.isArray(checklist.items) ? checklist.items : [];
  const errors = Array.isArray(checklist.errors) ? checklist.errors : [];
  const warnings = Array.isArray(checklist.warnings) ? checklist.warnings : [];

  if (tab === "Dashboard") {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <SummaryCard label="Current year" value={dashboard.current_financial_year || "-"} tone="blue" />
          <SummaryCard label="Open periods" value={dashboard.open_periods || 0} tone="emerald" />
          <SummaryCard label="Locked periods" value={dashboard.locked_periods || 0} tone="amber" />
          <SummaryCard label="Closed years" value={dashboard.closed_years || 0} tone="stone" />
          <SummaryCard label="Open tasks" value={dashboard.outstanding_tasks || 0} tone={dashboard.outstanding_tasks ? "amber" : "emerald"} />
          <SummaryCard label="Last closed" value={dashboard.last_year_closed || "-"} tone="stone" />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Year-end checklist">
            <div className="space-y-2">
              {checklistItems.map((item) => (
                <div key={item.label} className="flex items-center justify-between rounded-md border border-stone-100 bg-stone-50 px-3 py-2 text-sm">
                  <span>{item.label}</span>
                  <Badge className={item.complete ? "bg-emerald-100 text-emerald-900" : item.warning_only ? "bg-amber-100 text-amber-900" : "bg-red-100 text-red-900"}>
                    {item.complete ? "Complete" : item.warning_only ? "Warning" : "Open"}
                  </Badge>
                </div>
              ))}
              {!checklistItems.length && <p className="py-6 text-center text-sm text-stone-500">No year-end checks configured yet.</p>}
            </div>
          </Panel>
          <Panel title="Pending adjustments and warnings">
            {[...errors, ...warnings].length === 0 ? (
              <p className="py-8 text-center text-sm text-stone-500">No blockers or warnings for the current year.</p>
            ) : (
              <div className="space-y-2">
                {errors.map((item) => <div key={item} className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-800">{item}</div>)}
                {warnings.map((item) => <div key={item} className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800">{item}</div>)}
              </div>
            )}
          </Panel>
        </div>
      </div>
    );
  }

  if (tab === "Period Close") {
    return (
      <Panel title="Period close">
        <div className="mb-3 grid gap-2 md:grid-cols-[1fr_auto]">
          <Input value={periodReason} onChange={(e) => setPeriodReason(e.target.value)} placeholder="Reason for lock, close, or reopen" />
          <Button type="button" variant="outline" onClick={() => reloadWorkspace?.()} disabled={busy || saving}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
        </div>
        <div className="overflow-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2">Period</th>
                <th className="px-3 py-2">Start</th>
                <th className="px-3 py-2">End</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Transactions</th>
                <th className="px-3 py-2">Last updated</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((period) => (
                <tr key={period.id} className="border-t border-stone-100">
                  <td className="px-3 py-2 font-medium">{period.period_name}</td>
                  <td className="px-3 py-2">{formatDate(period.period_start)}</td>
                  <td className="px-3 py-2">{formatDate(period.period_end)}</td>
                  <td className="px-3 py-2"><Badge variant="outline">{period.status}</Badge></td>
                  <td className="px-3 py-2">{period.transactions_posted || 0}</td>
                  <td className="px-3 py-2">{formatDateTime(period.updated_at)}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      {period.status === "open" && <Button size="sm" variant="outline" onClick={() => periodAction(period, "lock")} disabled={saving}>Lock</Button>}
                      {period.status !== "closed" && <Button size="sm" onClick={() => periodAction(period, "close")} disabled={saving}>Close</Button>}
                      {period.status !== "open" && <Button size="sm" variant="outline" onClick={() => periodAction(period, "reopen")} disabled={saving}>Reopen</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    );
  }

  if (tab === "Financial Year Close") {
    return (
      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel title="Guided close">
          <div className="space-y-3">
            <Info label="Financial year" value={currentYear?.name} />
            <div className="grid gap-2 md:grid-cols-2">
              <Info label="Start date" value={formatDate(currentYear?.start_date)} />
              <Info label="End date" value={formatDate(currentYear?.end_date)} />
            </div>
            <Input value={closeReason} onChange={(e) => setCloseReason(e.target.value)} placeholder="Close reason or approval note" />
            <div className="space-y-2">
              {checklistItems.map((item) => (
                <div key={item.label} className="flex items-center justify-between rounded-md bg-stone-50 px-3 py-2 text-sm">
                  <span>{item.label}</span>
                  <Badge className={item.complete ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}>{item.complete ? "Ready" : "Review"}</Badge>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button onClick={() => closeYear(currentYear)} disabled={saving || errors.length > 0 || !currentYear}>Close financial year</Button>
              <Button variant="outline" onClick={() => reopenYear(currentYear)} disabled={saving || !currentYear}>Reopen</Button>
            </div>
            {errors.length > 0 && <p className="text-sm text-red-700">Resolve blocker checks before closing.</p>}
          </div>
        </Panel>
        <Panel title="Review balances">
          <div className="grid gap-3 md:grid-cols-3">
            <SummaryCard label="Income" value={formatMoney(data.profit_and_loss?.income)} tone="emerald" />
            <SummaryCard label="Expenses" value={formatMoney(data.profit_and_loss?.expenses)} tone="amber" />
            <SummaryCard label="Profit/loss" value={formatMoney(data.profit_and_loss?.profit)} tone="blue" />
          </div>
          <div className="mt-3">
            <ReportTable rows={data.trial_balance || []} columns={[["code", "Code"], ["name", "Account"], ["category", "Category"], ["debit", "Debit", "money"], ["credit", "Credit", "money"]]} empty="No trial balance rows for this year." compact />
          </div>
        </Panel>
      </div>
    );
  }

  if (tab === "Opening Balances") {
    return (
      <div className="space-y-4">
        <Panel title="Opening balance preview">
          <ReportTable rows={openingPreview} columns={[["account_code", "Code"], ["account_name", "Account"], ["category", "Category"], ["debit", "Debit", "money"], ["credit", "Credit", "money"]]} empty="No opening balance preview yet." compact />
        </Panel>
        <Panel title="Generated opening balances">
          <ReportTable rows={openingBalances} columns={[["account_code", "Code"], ["account_name", "Account"], ["debit", "Debit", "money"], ["credit", "Credit", "money"], ["status", "Status"], ["created_at", "Created"]]} empty="No opening balances generated yet." compact />
        </Panel>
      </div>
    );
  }

  if (tab === "Closing Journals") {
    return (
      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel title="Closing journals">
          <ReportTable rows={closingJournals} columns={[["entry_date", "Date", "date"], ["reference", "Reference"], ["description", "Description"], ["total_debit", "Debit", "money"], ["total_credit", "Credit", "money"], ["status", "Status"]]} empty="No year-end journals posted yet." compact />
        </Panel>
        <Panel title="Manual adjustment journal">
          <form className="space-y-3" onSubmit={postAdjustment}>
            <div className="grid gap-2 md:grid-cols-3">
              <Field label="Entry date" type="date" value={journalForm.entry_date} onChange={(value) => setJournalForm((current) => ({ ...current, entry_date: value }))} />
              <Field label="Reference" value={journalForm.reference} onChange={(value) => setJournalForm((current) => ({ ...current, reference: value }))} />
              <Field label="Reason" value={journalForm.reason} onChange={(value) => setJournalForm((current) => ({ ...current, reason: value }))} />
            </div>
            {journalForm.lines.map((line, index) => (
              <div key={index} className="grid gap-2 md:grid-cols-[1.4fr_0.7fr_0.7fr_1fr]">
                <AccountCodeSelect accounts={accounts} value={line.account_code} onChange={(value) => setJournalForm((current) => ({ ...current, lines: current.lines.map((row, i) => i === index ? { ...row, account_code: value } : row) }))} label={`Line ${index + 1} account`} />
                <Field label="Debit" value={line.debit} onChange={(value) => setJournalForm((current) => ({ ...current, lines: current.lines.map((row, i) => i === index ? { ...row, debit: value } : row) }))} />
                <Field label="Credit" value={line.credit} onChange={(value) => setJournalForm((current) => ({ ...current, lines: current.lines.map((row, i) => i === index ? { ...row, credit: value } : row) }))} />
                <Field label="Description" value={line.description} onChange={(value) => setJournalForm((current) => ({ ...current, lines: current.lines.map((row, i) => i === index ? { ...row, description: value } : row) }))} />
              </div>
            ))}
            <Button type="button" variant="outline" onClick={() => setJournalForm((current) => ({ ...current, lines: [...current.lines, { account_code: "", debit: "", credit: "", description: "" }] }))}>Add line</Button>
            <Button type="submit" disabled={saving}>Post adjustment</Button>
          </form>
        </Panel>
      </div>
    );
  }

  if (tab === "Retained Earnings") {
    return (
      <Panel title="Retained earnings transfer">
        <div className="grid gap-3 md:grid-cols-3">
          <SummaryCard label="Retained earnings account" value={data.retained_earnings?.account_code || settings.retained_earnings_account || "3200"} tone="blue" />
          <SummaryCard label="Current year profit/loss" value={formatMoney(data.retained_earnings?.current_year_profit)} tone="emerald" />
          <SummaryCard label="Automatic transfer" value={data.retained_earnings?.automatic_transfer ? "On" : "Off"} tone="stone" />
        </div>
        <div className="mt-4">
          <ReportTable rows={data.profit_and_loss?.rows || []} columns={[["code", "Code"], ["name", "Account"], ["category", "Category"], ["amount", "Amount", "money"]]} empty="No income or expense balances for the selected year." compact />
        </div>
      </Panel>
    );
  }

  if (tab === "Lock History") {
    return (
      <Panel title="Lock history">
        <ReportTable rows={history} columns={[["created_at", "Date"], ["event_type", "Action"], ["reason", "Reason"], ["financial_year_id", "Year"], ["period_id", "Period"], ["journal_entry_id", "Journal"]]} empty="No lock or close history yet." compact />
      </Panel>
    );
  }

  if (tab === "Reports") {
    return (
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Year-end checklist"><ReportTable rows={reports.year_end_checklist || []} columns={[["item", "Item"], ["status", "Status"], ["count", "Count"]]} compact /></Panel>
        <Panel title="Period lock report"><ReportTable rows={reports.period_lock_report || []} columns={[["created_at", "Date"], ["event_type", "Action"], ["reason", "Reason"]]} compact /></Panel>
        <Panel title="Opening balance report"><ReportTable rows={reports.opening_balance_report || []} columns={[["account_code", "Code"], ["account_name", "Account"], ["debit", "Debit", "money"], ["credit", "Credit", "money"]]} compact /></Panel>
        <Panel title="Financial year summary"><ReportTable rows={reports.financial_year_summary || []} columns={[["name", "Year"], ["start_date", "Start", "date"], ["end_date", "End", "date"], ["status", "Status"]]} compact /></Panel>
      </div>
    );
  }

  if (tab === "Settings") {
    return (
      <Panel title="Year-end settings">
        <form className="space-y-4" onSubmit={saveSettings}>
          <AccountCodeSelect accounts={accounts} value={settingsForm.retained_earnings_account || "3200"} onChange={(value) => setSettingsForm((current) => ({ ...current, retained_earnings_account: value }))} label="Retained earnings account" />
          <div className="grid gap-3 md:grid-cols-3">
            {[
              ["allow_period_reopen", "Allow period reopen"],
              ["automatic_opening_balances", "Automatic opening balances"],
              ["year_end_approval_required", "Year-end approval required"],
            ].map(([key, label]) => (
              <label key={key} className="flex items-start gap-2 rounded-md border border-stone-200 bg-stone-50 p-3 text-sm">
                <input type="checkbox" checked={!!settingsForm[key]} onChange={(e) => setSettingsForm((current) => ({ ...current, [key]: e.target.checked }))} />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <Button type="submit" disabled={saving}>Save year-end settings</Button>
        </form>
      </Panel>
    );
  }

  return <PlaceholderModulePanel title={tab} moduleTitle="Year End" />;
}

function FixedAssetsWorkspace({ workspace, tab, reloadWorkspace, busy }) {
  const clientId = workspace?.client?.id;
  const fixedAssets = workspace?.fixed_assets || {};
  const accounts = Array.isArray(workspace?.accounts) ? workspace.accounts : [];
  const ap = workspace?.accounts_payable || {};
  const suppliers = Array.isArray(ap.suppliers) ? ap.suppliers : [];
  const categories = Array.isArray(fixedAssets.categories) ? fixedAssets.categories : [];
  const assets = Array.isArray(fixedAssets.assets) ? fixedAssets.assets : [];
  const activeAssets = assets.filter((asset) => (asset.status || "active") === "active");
  const events = Array.isArray(fixedAssets.events) ? fixedAssets.events : [];
  const schedule = Array.isArray(fixedAssets.depreciation_schedule) ? fixedAssets.depreciation_schedule : [];
  const reports = fixedAssets.reports || {};
  const dashboard = fixedAssets.dashboard || {};
  const panels = fixedAssets.panels || {};
  const settings = fixedAssets.settings || {};
  const [saving, setSaving] = useState(false);
  const [categoryForm, setCategoryForm] = useState({ name: "", description: "", default_useful_life_months: 36, default_depreciation_method: "straight_line", default_residual_value: "0.00", fixed_asset_account: settings.default_fixed_asset_account || "1500", accumulated_depreciation_account: settings.default_accumulated_depreciation_account || "1590", depreciation_expense_account: settings.default_depreciation_expense_account || "7000", active: true });
  const [assetForm, setAssetForm] = useState({ asset_name: "", description: "", category_id: "", location: "", department: "", supplier_id: "", supplier_name: "", purchase_date: "", in_service_date: "", purchase_cost: "", residual_value: "0.00", useful_life_months: 36, depreciation_method: "straight_line", fixed_asset_account: settings.default_fixed_asset_account || "1500", accumulated_depreciation_account: settings.default_accumulated_depreciation_account || "1590", depreciation_expense_account: settings.default_depreciation_expense_account || "7000", notes: "" });
  const [actionForm, setActionForm] = useState({ asset_id: "", date: "", amount: "", location: "", department: "", notes: "", disposal_type: "sale" });
  const [settingsForm, setSettingsForm] = useState(settings);

  useEffect(() => {
    setSettingsForm(fixedAssets.settings || {});
  }, [fixedAssets.settings]);

  function selectedAsset() {
    return activeAssets.find((asset) => asset.id === actionForm.asset_id) || activeAssets[0] || null;
  }

  function applyCategory(categoryId) {
    const category = categories.find((item) => item.id === categoryId);
    setAssetForm((current) => ({
      ...current,
      category_id: categoryId,
      useful_life_months: category?.default_useful_life_months || current.useful_life_months,
      depreciation_method: category?.default_depreciation_method || current.depreciation_method,
      residual_value: category?.default_residual_value || current.residual_value,
      fixed_asset_account: category?.fixed_asset_account || current.fixed_asset_account,
      accumulated_depreciation_account: category?.accumulated_depreciation_account || current.accumulated_depreciation_account,
      depreciation_expense_account: category?.depreciation_expense_account || current.depreciation_expense_account,
    }));
  }

  function applySupplier(supplierId) {
    const supplier = suppliers.find((item) => item.id === supplierId);
    setAssetForm((current) => ({ ...current, supplier_id: supplierId, supplier_name: supplier?.name || "" }));
  }

  function applySuggestion(suggestion) {
    setAssetForm((current) => ({
      ...current,
      asset_name: suggestion.asset_name || current.asset_name,
      description: suggestion.asset_name || current.description,
      supplier_id: suggestion.supplier_id || current.supplier_id,
      supplier_name: suggestion.supplier_name || current.supplier_name,
      purchase_date: suggestion.purchase_date || current.purchase_date,
      in_service_date: suggestion.purchase_date || current.in_service_date,
      purchase_cost: suggestion.purchase_cost || current.purchase_cost,
      purchase_invoice_id: suggestion.purchase_invoice_id || "",
      notes: suggestion.reason || current.notes,
    }));
    toast.success("Asset suggestion copied into the register form");
  }

  async function submitCategory(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/admin/accounting/clients/${clientId}/fixed-assets/categories`, categoryForm);
      toast.success("Asset category saved");
      setCategoryForm((current) => ({ ...current, name: "", description: "" }));
      await reloadWorkspace?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  }

  async function submitAsset(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/admin/accounting/clients/${clientId}/fixed-assets`, assetForm);
      toast.success("Fixed asset created");
      setAssetForm((current) => ({ ...current, asset_name: "", description: "", purchase_cost: "", notes: "" }));
      await reloadWorkspace?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  }

  async function postAssetAction(endpoint, payload, message) {
    const asset = selectedAsset();
    if (!asset) {
      toast.error("Select an active asset first");
      return;
    }
    setSaving(true);
    try {
      await api.post(`/admin/accounting/clients/${clientId}/fixed-assets/${asset.id}/${endpoint}`, payload);
      toast.success(message);
      await reloadWorkspace?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  }

  async function saveSettings(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put(`/admin/accounting/clients/${clientId}/fixed-assets/settings`, settingsForm);
      toast.success("Fixed asset settings saved");
      await reloadWorkspace?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  }

  const actionAsset = selectedAsset();

  if (tab === "Dashboard") {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <SummaryCard label="Total asset cost" value={formatMoney(dashboard.total_asset_cost)} tone="blue" />
          <SummaryCard label="Net book value" value={formatMoney(dashboard.net_book_value)} tone="emerald" />
          <SummaryCard label="Accum. depreciation" value={formatMoney(dashboard.accumulated_depreciation)} tone="amber" />
          <SummaryCard label="Added this year" value={dashboard.assets_added_this_year || 0} tone="stone" />
          <SummaryCard label="Disposed" value={dashboard.assets_disposed || 0} tone="stone" />
          <SummaryCard label="Depreciation this month" value={formatMoney(dashboard.depreciation_this_month)} tone="blue" />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Assets awaiting depreciation">
            <ReportTable rows={panels.awaiting_depreciation || []} columns={[["asset_code", "Asset"], ["asset_name", "Name"], ["period_label", "Period"], ["charge", "Charge", "money"]]} empty="No scheduled depreciation due." compact />
          </Panel>
          <Panel title="AI capitalisation suggestions">
            {(fixedAssets.suggestions || []).length === 0 ? <p className="py-8 text-center text-sm text-stone-500">No purchase invoices currently look like capital assets.</p> : (
              <div className="space-y-2">
                {(fixedAssets.suggestions || []).map((item) => (
                  <div key={item.purchase_invoice_id || item.reference} className="flex items-center justify-between gap-3 rounded-md border border-stone-100 p-3 text-sm">
                    <div>
                      <strong>{item.asset_name}</strong>
                      <p className="text-stone-500">{item.supplier_name || "Unknown supplier"} · {formatMoney(item.purchase_cost)} · confidence {item.confidence}%</p>
                    </div>
                    <Button type="button" variant="outline" onClick={() => applySuggestion(item)}>Use</Button>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
        <Panel title="Recently acquired assets">
          <ReportTable rows={panels.recently_acquired || []} columns={[["asset_code", "Asset ID"], ["asset_name", "Asset"], ["category_name", "Category"], ["purchase_date", "Purchase date", "date"], ["purchase_cost", "Cost", "money"], ["net_book_value", "NBV", "money"]]} empty="No fixed assets yet." />
        </Panel>
      </div>
    );
  }

  if (tab === "Asset Register") {
    return (
      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <Panel title="Create asset">
          <form onSubmit={submitAsset} className="space-y-3">
            <Field label="Asset name" value={assetForm.asset_name} onChange={(value) => setAssetForm((current) => ({ ...current, asset_name: value }))} />
            <Field label="Description" value={assetForm.description} onChange={(value) => setAssetForm((current) => ({ ...current, description: value }))} />
            <div className="grid gap-3 md:grid-cols-2">
              <SelectField label="Category" value={assetForm.category_id} onChange={applyCategory} options={categories.filter((c) => c.active).map((c) => [c.id, c.name])} />
              <SupplierSelect suppliers={suppliers} value={assetForm.supplier_id} onChange={applySupplier} />
              <Field label="Purchase date" type="date" value={assetForm.purchase_date} onChange={(value) => setAssetForm((current) => ({ ...current, purchase_date: value }))} />
              <Field label="In service date" type="date" value={assetForm.in_service_date} onChange={(value) => setAssetForm((current) => ({ ...current, in_service_date: value }))} />
              <Field label="Purchase cost" value={assetForm.purchase_cost} onChange={(value) => setAssetForm((current) => ({ ...current, purchase_cost: value }))} />
              <Field label="Residual value" value={assetForm.residual_value} onChange={(value) => setAssetForm((current) => ({ ...current, residual_value: value }))} />
              <Field label="Useful life months" type="number" value={assetForm.useful_life_months} onChange={(value) => setAssetForm((current) => ({ ...current, useful_life_months: value }))} />
              <SelectField label="Method" value={assetForm.depreciation_method} onChange={(value) => setAssetForm((current) => ({ ...current, depreciation_method: value }))} options={[["straight_line", "Straight line"], ["reducing_balance", "Reducing balance"]]} />
              <Field label="Location" value={assetForm.location} onChange={(value) => setAssetForm((current) => ({ ...current, location: value }))} />
              <Field label="Department" value={assetForm.department} onChange={(value) => setAssetForm((current) => ({ ...current, department: value }))} />
            </div>
            <AccountCodeSelect label="Fixed asset account" accounts={accounts} value={assetForm.fixed_asset_account} onChange={(value) => setAssetForm((current) => ({ ...current, fixed_asset_account: value }))} />
            <AccountCodeSelect label="Accumulated depreciation account" accounts={accounts} value={assetForm.accumulated_depreciation_account} onChange={(value) => setAssetForm((current) => ({ ...current, accumulated_depreciation_account: value }))} />
            <AccountCodeSelect label="Depreciation expense account" accounts={accounts} value={assetForm.depreciation_expense_account} onChange={(value) => setAssetForm((current) => ({ ...current, depreciation_expense_account: value }))} />
            <Button type="submit" disabled={saving || busy}>Create asset</Button>
          </form>
        </Panel>
        <Panel title="Asset register">
          <ReportTable rows={assets} columns={[["asset_code", "Asset ID"], ["asset_name", "Asset"], ["category_name", "Category"], ["location", "Location"], ["purchase_date", "Purchase", "date"], ["purchase_cost", "Cost", "money"], ["accumulated_depreciation", "Depreciation", "money"], ["net_book_value", "NBV", "money"], ["status", "Status"]]} empty="No assets created yet." />
        </Panel>
      </div>
    );
  }

  if (tab === "Asset Categories") {
    return (
      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <Panel title="Add category">
          <form onSubmit={submitCategory} className="space-y-3">
            <Field label="Category name" value={categoryForm.name} onChange={(value) => setCategoryForm((current) => ({ ...current, name: value }))} />
            <Field label="Description" value={categoryForm.description} onChange={(value) => setCategoryForm((current) => ({ ...current, description: value }))} />
            <div className="grid gap-3 md:grid-cols-2">
              <SelectField label="Default method" value={categoryForm.default_depreciation_method} onChange={(value) => setCategoryForm((current) => ({ ...current, default_depreciation_method: value }))} options={[["straight_line", "Straight line"], ["reducing_balance", "Reducing balance"]]} />
              <Field label="Useful life months" type="number" value={categoryForm.default_useful_life_months} onChange={(value) => setCategoryForm((current) => ({ ...current, default_useful_life_months: value }))} />
              <Field label="Residual value" value={categoryForm.default_residual_value} onChange={(value) => setCategoryForm((current) => ({ ...current, default_residual_value: value }))} />
            </div>
            <AccountCodeSelect label="Fixed asset account" accounts={accounts} value={categoryForm.fixed_asset_account} onChange={(value) => setCategoryForm((current) => ({ ...current, fixed_asset_account: value }))} />
            <AccountCodeSelect label="Accumulated depreciation account" accounts={accounts} value={categoryForm.accumulated_depreciation_account} onChange={(value) => setCategoryForm((current) => ({ ...current, accumulated_depreciation_account: value }))} />
            <AccountCodeSelect label="Depreciation expense account" accounts={accounts} value={categoryForm.depreciation_expense_account} onChange={(value) => setCategoryForm((current) => ({ ...current, depreciation_expense_account: value }))} />
            <Button type="submit" disabled={saving || busy}>Save category</Button>
          </form>
        </Panel>
        <Panel title="Categories">
          <ReportTable rows={categories} columns={[["name", "Category"], ["default_depreciation_method", "Method"], ["default_useful_life_months", "Life months"], ["fixed_asset_account", "Asset account"], ["accumulated_depreciation_account", "Accumulated"], ["depreciation_expense_account", "Expense"], ["active", "Active"]]} empty="No categories configured." />
        </Panel>
      </div>
    );
  }

  if (tab === "Depreciation") {
    return (
      <div className="space-y-4">
        <AssetActionPanel title="Post depreciation" assets={activeAssets} actionForm={actionForm} setActionForm={setActionForm}>
          <Button type="button" disabled={saving || !actionAsset} onClick={() => postAssetAction("depreciation/post", { charge: actionForm.amount }, "Depreciation journal posted")}>Post next depreciation</Button>
        </AssetActionPanel>
        <Panel title="Depreciation schedule">
          <ReportTable rows={schedule} columns={[["asset_code", "Asset"], ["asset_name", "Name"], ["period_label", "Period"], ["opening_nbv", "Opening NBV", "money"], ["charge", "Charge", "money"], ["accumulated_depreciation", "Accumulated", "money"], ["closing_nbv", "Closing NBV", "money"], ["status", "Status"]]} empty="No depreciation schedule yet." />
        </Panel>
      </div>
    );
  }

  if (tab === "Disposals") {
    return (
      <div className="space-y-4">
        <AssetActionPanel title="Dispose asset" assets={activeAssets} actionForm={actionForm} setActionForm={setActionForm}>
          <div className="grid gap-3 md:grid-cols-3">
            <SelectField label="Disposal type" value={actionForm.disposal_type} onChange={(value) => setActionForm((current) => ({ ...current, disposal_type: value }))} options={[["sale", "Sale"], ["scrap", "Scrap"], ["write_off", "Write-off"]]} />
            <Field label="Disposal date" type="date" value={actionForm.date} onChange={(value) => setActionForm((current) => ({ ...current, date: value }))} />
            <Field label="Proceeds" value={actionForm.amount} onChange={(value) => setActionForm((current) => ({ ...current, amount: value }))} />
          </div>
          <Button type="button" disabled={saving || !actionAsset} onClick={() => postAssetAction("dispose", { disposal_type: actionForm.disposal_type, disposal_date: actionForm.date, disposal_proceeds: actionForm.amount, notes: actionForm.notes }, "Asset disposed")}>Dispose asset</Button>
        </AssetActionPanel>
        <ReportTable rows={reports.asset_disposals || []} columns={[["asset_code", "Asset"], ["asset_name", "Name"], ["disposal_date", "Date", "date"], ["disposal_proceeds", "Proceeds", "money"], ["status", "Status"]]} empty="No disposals yet." />
      </div>
    );
  }

  if (tab === "Transfers") {
    return (
      <div className="space-y-4">
        <AssetActionPanel title="Transfer asset" assets={activeAssets} actionForm={actionForm} setActionForm={setActionForm}>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Transfer date" type="date" value={actionForm.date} onChange={(value) => setActionForm((current) => ({ ...current, date: value }))} />
            <Field label="New location" value={actionForm.location} onChange={(value) => setActionForm((current) => ({ ...current, location: value }))} />
            <Field label="New department" value={actionForm.department} onChange={(value) => setActionForm((current) => ({ ...current, department: value }))} />
          </div>
          <Button type="button" disabled={saving || !actionAsset} onClick={() => postAssetAction("transfer", { transfer_date: actionForm.date, location: actionForm.location, department: actionForm.department, notes: actionForm.notes }, "Asset transfer recorded")}>Record transfer</Button>
        </AssetActionPanel>
        <ReportTable rows={events.filter((event) => event.event_type === "transfer")} columns={[["event_date", "Date", "date"], ["asset_id", "Asset"], ["from_value", "From"], ["to_value", "To"], ["notes", "Notes"]]} empty="No transfers recorded." />
      </div>
    );
  }

  if (tab === "Revaluations") {
    return (
      <div className="space-y-4">
        <AssetActionPanel title="Revalue asset" assets={activeAssets} actionForm={actionForm} setActionForm={setActionForm}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Revaluation date" type="date" value={actionForm.date} onChange={(value) => setActionForm((current) => ({ ...current, date: value }))} />
            <Field label="New value" value={actionForm.amount} onChange={(value) => setActionForm((current) => ({ ...current, amount: value }))} />
          </div>
          <Button type="button" disabled={saving || !actionAsset} onClick={() => postAssetAction("revalue", { revaluation_date: actionForm.date, new_value: actionForm.amount, notes: actionForm.notes }, "Asset revaluation posted")}>Post revaluation</Button>
        </AssetActionPanel>
        <ReportTable rows={reports.revaluations || []} columns={[["event_date", "Date", "date"], ["asset_id", "Asset"], ["from_value", "From"], ["to_value", "To"], ["amount", "Movement", "money"], ["notes", "Notes"]]} empty="No revaluations posted." />
      </div>
    );
  }

  if (tab === "Reports") {
    return (
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Net book value summary"><ReportTable rows={reports.nbv_summary || []} columns={[["category", "Category"], ["count", "Assets"], ["cost", "Cost", "money"], ["nbv", "NBV", "money"]]} empty="No asset summary yet." /></Panel>
        <Panel title="Category analysis"><ReportTable rows={reports.category_analysis || []} columns={[["category", "Category"], ["count", "Assets"], ["cost", "Cost", "money"], ["nbv", "NBV", "money"]]} empty="No category analysis yet." /></Panel>
        <Panel title="Asset additions"><ReportTable rows={reports.asset_additions || []} columns={[["asset_code", "Asset"], ["asset_name", "Name"], ["purchase_date", "Date", "date"], ["purchase_cost", "Cost", "money"]]} empty="No additions this year." /></Panel>
        <Panel title="Depreciation schedule"><ReportTable rows={reports.depreciation_schedule || []} columns={[["asset_code", "Asset"], ["period_label", "Period"], ["charge", "Charge", "money"], ["closing_nbv", "Closing NBV", "money"]]} empty="No schedule yet." /></Panel>
      </div>
    );
  }

  if (tab === "Settings") {
    return (
      <Panel title="Fixed asset settings">
        <form onSubmit={saveSettings} className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <SelectField label="Default depreciation method" value={settingsForm.default_depreciation_method} onChange={(value) => setSettingsForm((current) => ({ ...current, default_depreciation_method: value }))} options={[["straight_line", "Straight line"], ["reducing_balance", "Reducing balance"]]} />
          <SelectField label="Posting frequency" value={settingsForm.posting_frequency} onChange={(value) => setSettingsForm((current) => ({ ...current, posting_frequency: value }))} options={[["monthly", "Monthly"], ["quarterly", "Quarterly"], ["annual", "Annual"]]} />
          <Field label="Capitalisation threshold" value={settingsForm.capitalisation_threshold} onChange={(value) => setSettingsForm((current) => ({ ...current, capitalisation_threshold: value }))} />
          <Field label="Asset prefix" value={settingsForm.asset_number_prefix} onChange={(value) => setSettingsForm((current) => ({ ...current, asset_number_prefix: value }))} />
          <Field label="Next asset number" type="number" value={settingsForm.next_asset_number} onChange={(value) => setSettingsForm((current) => ({ ...current, next_asset_number: value }))} />
          <AccountCodeSelect label="Default fixed asset account" accounts={accounts} value={settingsForm.default_fixed_asset_account} onChange={(value) => setSettingsForm((current) => ({ ...current, default_fixed_asset_account: value }))} />
          <AccountCodeSelect label="Default accumulated depreciation" accounts={accounts} value={settingsForm.default_accumulated_depreciation_account} onChange={(value) => setSettingsForm((current) => ({ ...current, default_accumulated_depreciation_account: value }))} />
          <AccountCodeSelect label="Default depreciation expense" accounts={accounts} value={settingsForm.default_depreciation_expense_account} onChange={(value) => setSettingsForm((current) => ({ ...current, default_depreciation_expense_account: value }))} />
          <AccountCodeSelect label="Default disposal account" accounts={accounts} value={settingsForm.default_disposal_account} onChange={(value) => setSettingsForm((current) => ({ ...current, default_disposal_account: value }))} />
          <div className="md:col-span-2 xl:col-span-3"><Button type="submit" disabled={saving || busy}>Save fixed asset settings</Button></div>
        </form>
      </Panel>
    );
  }

  return <PlaceholderModulePanel title={tab} moduleTitle="Fixed Assets" />;
}

function SelectField({ label, value, onChange, options = [] }) {
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

function AssetActionPanel({ title, assets, actionForm, setActionForm, children }) {
  return (
    <Panel title={title}>
      <div className="space-y-3">
        <SelectField label="Asset" value={actionForm.asset_id || assets?.[0]?.id || ""} onChange={(value) => setActionForm((current) => ({ ...current, asset_id: value }))} options={(Array.isArray(assets) ? assets : []).map((asset) => [asset.id, `${asset.asset_code} - ${asset.asset_name}`])} />
        <Field label="Notes" value={actionForm.notes} onChange={(value) => setActionForm((current) => ({ ...current, notes: value }))} />
        {children}
      </div>
    </Panel>
  );
}

function AccountCodeSelect({ accounts, value, onChange, label }) {
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

function AgedCreditorsTable({ rows }) {
  return (
    <Panel title="Aged creditors">
      {rows.length === 0 ? <p className="py-10 text-center text-sm text-stone-500">No outstanding supplier balances.</p> : (
        <div className="overflow-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Supplier</th><th className="px-3 py-2 text-right">Current</th><th className="px-3 py-2 text-right">1-30</th><th className="px-3 py-2 text-right">31-60</th><th className="px-3 py-2 text-right">61-90</th><th className="px-3 py-2 text-right">90+</th><th className="px-3 py-2 text-right">Total</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.supplier_id || row.supplier_name} className="border-t border-stone-100"><td className="px-3 py-2 font-semibold">{row.supplier_name}</td><td className="px-3 py-2 text-right">{formatMoney(row.current)}</td><td className="px-3 py-2 text-right">{formatMoney(row.days_1_30)}</td><td className="px-3 py-2 text-right">{formatMoney(row.days_31_60)}</td><td className="px-3 py-2 text-right">{formatMoney(row.days_61_90)}</td><td className="px-3 py-2 text-right">{formatMoney(row.days_90_plus)}</td><td className="px-3 py-2 text-right font-semibold">{formatMoney(row.total)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function ApReports({ ap }) {
  const invoices = ap.invoices || [];
  const unpaid = invoices.filter((invoice) => Number(invoice.outstanding_amount || 0) > 0);
  const vat = invoices.reduce((sum, invoice) => sum + Number(invoice.vat_amount || 0), 0);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <SummaryCard label="Purchase day book" value={invoices.length} tone="blue" />
        <SummaryCard label="Unpaid bills" value={unpaid.length} tone="amber" />
        <SummaryCard label="VAT on purchases" value={formatMoney(vat)} tone="emerald" />
        <SummaryCard label="Supplier balances" value={formatMoney(ap.dashboard?.outstanding_total)} tone="stone" />
      </div>
      <ApRegister title="Unpaid bills" rows={unpaid} numberKey="invoice_number" dateKey="invoice_date" amountKey="gross_amount" empty="No unpaid bills." />
    </div>
  );
}

function apFormTotals(lines) {
  return (lines || []).reduce((total, line) => {
    const net = Number(line.net_amount || 0);
    const vat = Number(line.vat_amount || 0);
    const gross = Number(line.gross_amount || (net + vat) || 0);
    return { net: total.net + net, vat: total.vat + vat, gross: total.gross + gross };
  }, { net: 0, vat: 0, gross: 0 });
}

function statementRows(supplierId, invoices, creditNotes, payments) {
  let balance = 0;
  return [
    ...invoices.filter((item) => item.supplier_id === supplierId).map((item) => ({ id: item.id, date: item.invoice_date, type: "Invoice", reference: item.invoice_number, debit: Number(item.gross_amount || 0), credit: 0 })),
    ...creditNotes.filter((item) => item.supplier_id === supplierId).map((item) => ({ id: item.id, date: item.credit_note_date, type: "Credit note", reference: item.credit_note_number, debit: 0, credit: Number(item.gross_amount || 0) })),
    ...payments.filter((item) => item.supplier_id === supplierId).map((item) => ({ id: item.id, date: item.payment_date, type: "Payment", reference: item.reference, debit: 0, credit: Number(item.amount || 0) })),
  ].sort((a, b) => String(a.date || "").localeCompare(String(b.date || ""))).map((row) => {
    balance += row.debit - row.credit;
    return { ...row, balance };
  });
}

function apStatusClass(status) {
  if (status === "posted" || status === "paid") return "bg-emerald-100 text-emerald-800 hover:bg-emerald-100";
  if (status === "part_paid" || status === "approved") return "bg-sky-100 text-sky-800 hover:bg-sky-100";
  if (status === "awaiting_approval") return "bg-amber-100 text-amber-800 hover:bg-amber-100";
  if (status === "void") return "bg-red-100 text-red-800 hover:bg-red-100";
  return "bg-stone-100 text-stone-700 hover:bg-stone-100";
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

function VatEngineWorkspace({ workspace, tab, reloadWorkspace, busy }) {
  const vat = useMemo(() => workspace?.vat_engine || {}, [workspace?.vat_engine]);
  const clientId = workspace?.client?.id;
  const settings = useMemo(() => vat.settings || {}, [vat.settings]);
  const codes = vat.codes || [];
  const activeCodes = codes.filter((code) => code.active !== false);
  const periods = vat.periods || [];
  const transactions = vat.transactions || [];
  const returns = vat.returns || [];
  const adjustments = vat.adjustments || [];
  const dashboard = vat.dashboard || {};
  const currentBoxes = vat.current_boxes || {};
  const currentPeriod = periods.find((period) => period.id === dashboard.current_period_id) || periods.find((period) => period.status === "open") || periods[0];
  const [search, setSearch] = useState("");
  const [vatCodeFilter, setVatCodeFilter] = useState("");
  const [settingsForm, setSettingsForm] = useState(settings);
  const [codeForm, setCodeForm] = useState({ code: "", description: "", percentage: "20", purchase_behavior: "input", sales_behavior: "output", return_box_net: "7", return_box_vat: "4", active: true });
  const [adjustmentForm, setAdjustmentForm] = useState({ adjustment_date: "", vat_period_id: "", vat_code: "", reason: "", notes: "", net_amount: "", vat_amount: "", gross_amount: "" });
  const [openBox, setOpenBox] = useState(null);

  useEffect(() => {
    setSettingsForm(settings || {});
  }, [settings]);

  useEffect(() => {
    if (!adjustmentForm.vat_period_id && currentPeriod?.id) {
      setAdjustmentForm((current) => ({ ...current, vat_period_id: currentPeriod.id }));
    }
  }, [currentPeriod?.id, adjustmentForm.vat_period_id]);

  const filteredTransactions = transactions.filter((transaction) => {
    const query = search.trim().toLowerCase();
    const matchesQuery = !query || [
      transaction.document_number,
      transaction.account_name,
      transaction.source_module,
      transaction.document_type,
      transaction.vat_code,
      transaction.status,
    ].some((value) => String(value || "").toLowerCase().includes(query));
    const matchesCode = !vatCodeFilter || transaction.vat_code === vatCodeFilter;
    return matchesQuery && matchesCode;
  });

  async function runVatAction(action, successMessage) {
    try {
      await action();
      toast.success(successMessage);
      await reloadWorkspace();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }

  const prepareReturn = (period) => runVatAction(
    () => api.post(`/admin/accounting/clients/${clientId}/vat-returns/prepare`, { period_id: period?.id }),
    "VAT return generated"
  );

  const updatePeriod = (period, action) => runVatAction(
    () => api.post(`/admin/accounting/clients/${clientId}/vat/periods/${period.id}/${action}`),
    `VAT period ${action} complete`
  );

  const createCode = (event) => {
    event.preventDefault();
    return runVatAction(
      () => api.post(`/admin/accounting/clients/${clientId}/vat/codes`, codeForm),
      "VAT code created"
    ).then(() => setCodeForm({ code: "", description: "", percentage: "20", purchase_behavior: "input", sales_behavior: "output", return_box_net: "7", return_box_vat: "4", active: true }));
  };

  const saveSettings = (event) => {
    event.preventDefault();
    return runVatAction(
      () => api.put(`/admin/accounting/clients/${clientId}/vat/settings`, settingsForm),
      "VAT settings saved"
    );
  };

  const createAdjustment = (event) => {
    event.preventDefault();
    return runVatAction(
      () => api.post(`/admin/accounting/clients/${clientId}/vat/adjustments`, adjustmentForm),
      "VAT adjustment posted"
    ).then(() => setAdjustmentForm({ adjustment_date: "", vat_period_id: currentPeriod?.id || "", vat_code: "", reason: "", notes: "", net_amount: "", vat_amount: "", gross_amount: "" }));
  };

  if (tab === "Dashboard") {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <SummaryCard label="Current VAT Liability" value={formatMoney(dashboard.current_vat_liability)} />
          <SummaryCard label="VAT Due to HMRC" value={formatMoney(dashboard.vat_due_hmrc)} tone="warning" />
          <SummaryCard label="VAT Recoverable" value={formatMoney(dashboard.vat_recoverable)} tone="success" />
          <SummaryCard label="Current VAT Period" value={currentPeriod ? `${formatDate(currentPeriod.start_date)} - ${formatDate(currentPeriod.end_date)}` : "-"} />
          <SummaryCard label="Next Return Due" value={formatDate(dashboard.next_return_due)} />
          <SummaryCard label="Outstanding Returns" value={dashboard.outstanding_returns || 0} />
        </div>
        <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
          <Panel title="Current VAT Summary">
            <VatBoxGrid boxes={currentBoxes} transactions={transactions} onOpenBox={setOpenBox} />
            {openBox && <VatBoxDrilldown box={openBox} transactions={transactions} onClose={() => setOpenBox(null)} />}
          </Panel>
          <Panel title="Recent VAT Activity">
            <div className="space-y-2">
              {transactions.slice(0, 8).map((transaction) => (
                <div key={transaction.id} className="rounded-md border border-stone-200 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-stone-900">{transaction.document_number || transaction.document_type}</p>
                      <p className="text-xs text-stone-500">{formatDate(transaction.date)} - {transaction.source_module}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-display font-bold text-stone-900">{formatMoney(transaction.vat)}</p>
                      <p className="text-xs text-stone-500">{transaction.vat_code || "-"}</p>
                    </div>
                  </div>
                </div>
              ))}
              {transactions.length === 0 && <p className="py-8 text-center text-sm text-stone-500">No VAT activity yet.</p>}
            </div>
          </Panel>
        </div>
      </div>
    );
  }

  if (tab === "VAT Returns") {
    return (
      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <Panel title="VAT returns">
          <div className="space-y-3">
            {periods.map((period) => (
              <div key={period.id} className="grid gap-3 rounded-md border border-stone-200 p-3 lg:grid-cols-[1fr_repeat(4,120px)_auto] lg:items-center">
                <Info label="Period" value={`${formatDate(period.start_date)} - ${formatDate(period.end_date)}`} />
                <Info label="Output VAT" value={formatMoney(period.output_vat)} />
                <Info label="Input VAT" value={formatMoney(period.input_vat)} />
                <Info label="Net VAT" value={formatMoney(period.net_vat)} />
                <Info label="Status" value={period.status} />
                <Button variant="outline" disabled={busy || period.status === "closed"} onClick={() => prepareReturn(period)}>Generate</Button>
              </div>
            ))}
            {periods.length === 0 && <p className="py-10 text-center text-sm text-stone-500">No VAT periods available yet.</p>}
          </div>
        </Panel>
        <Panel title="Generated returns">
          <div className="space-y-2">
            {returns.map((vatReturn) => (
              <div key={vatReturn.id} className="rounded-md border border-stone-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-stone-900">{formatDate(vatReturn.period_start)} - {formatDate(vatReturn.period_end)}</p>
                    <p className="text-xs text-stone-500">Generated {formatDateTime(vatReturn.created_at)}</p>
                  </div>
                  <Badge variant="outline" className="capitalize">{vatReturn.status}</Badge>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <Info label="Box 1" value={formatMoney(vatReturn.box1)} />
                  <Info label="Box 4" value={formatMoney(vatReturn.box4)} />
                  <Info label="Box 5" value={formatMoney(vatReturn.box5)} />
                </div>
              </div>
            ))}
            {returns.length === 0 && <p className="py-8 text-center text-sm text-stone-500">No VAT returns generated yet.</p>}
          </div>
        </Panel>
      </div>
    );
  }

  if (tab === "VAT Transactions") {
    return (
      <Panel title="VAT transaction audit trail">
        <VatAccountingFilterBar search={search} setSearch={setSearch} extra={(
          <select value={vatCodeFilter} onChange={(e) => setVatCodeFilter(e.target.value)} className="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm">
            <option value="">All VAT codes</option>
            {activeCodes.map((code) => <option key={code.id} value={code.code}>{code.code} - {code.description}</option>)}
          </select>
        )} />
        <VatTransactionsTable transactions={filteredTransactions} />
      </Panel>
    );
  }

  if (tab === "VAT Codes") {
    return (
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Panel title="VAT codes">
          <VatCodeTable codes={codes} />
        </Panel>
        <Panel title="Create VAT code">
          <form onSubmit={createCode} className="space-y-3">
            <Field label="Code" value={codeForm.code} onChange={(value) => setCodeForm((current) => ({ ...current, code: value }))} />
            <Field label="Description" value={codeForm.description} onChange={(value) => setCodeForm((current) => ({ ...current, description: value }))} />
            <Field label="Percentage" type="number" value={codeForm.percentage} onChange={(value) => setCodeForm((current) => ({ ...current, percentage: value }))} />
            <VatSelect label="Purchase behaviour" value={codeForm.purchase_behavior} onChange={(value) => setCodeForm((current) => ({ ...current, purchase_behavior: value }))} options={["input", "none", "reverse_charge", "outside_scope"]} />
            <VatSelect label="Sales behaviour" value={codeForm.sales_behavior} onChange={(value) => setCodeForm((current) => ({ ...current, sales_behavior: value }))} options={["output", "none", "reverse_charge", "outside_scope"]} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Net box" value={codeForm.return_box_net} onChange={(value) => setCodeForm((current) => ({ ...current, return_box_net: value }))} />
              <Field label="VAT box" value={codeForm.return_box_vat} onChange={(value) => setCodeForm((current) => ({ ...current, return_box_vat: value }))} />
            </div>
            <label className="flex items-center gap-2 text-sm font-semibold text-stone-700">
              <input type="checkbox" checked={!!codeForm.active} onChange={(e) => setCodeForm((current) => ({ ...current, active: e.target.checked }))} />
              Active
            </label>
            <Button disabled={busy} className="w-full" style={{ background: "var(--brand)" }}>Create code</Button>
          </form>
        </Panel>
      </div>
    );
  }

  if (tab === "VAT Periods") {
    return (
      <Panel title="VAT periods">
        <VatPeriodTable periods={periods} onAction={updatePeriod} busy={busy} />
      </Panel>
    );
  }

  if (tab === "Adjustments") {
    return (
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Panel title="VAT adjustments">
          <div className="space-y-2">
            {adjustments.map((adjustment) => (
              <div key={adjustment.id} className="grid gap-3 rounded-md border border-stone-200 p-3 md:grid-cols-[120px_1fr_120px_120px] md:items-center">
                <Info label="Date" value={formatDate(adjustment.adjustment_date)} />
                <Info label="Reason" value={adjustment.reason || adjustment.notes || "VAT adjustment"} />
                <Info label="VAT code" value={adjustment.vat_code || "-"} />
                <Info label="VAT" value={formatMoney(adjustment.vat_amount)} />
              </div>
            ))}
            {adjustments.length === 0 && <p className="py-10 text-center text-sm text-stone-500">No VAT adjustments posted yet.</p>}
          </div>
        </Panel>
        <Panel title="Post adjustment">
          <form onSubmit={createAdjustment} className="space-y-3">
            <Field label="Adjustment date" type="date" value={adjustmentForm.adjustment_date} onChange={(value) => setAdjustmentForm((current) => ({ ...current, adjustment_date: value }))} />
            <VatSelect label="VAT period" value={adjustmentForm.vat_period_id} onChange={(value) => setAdjustmentForm((current) => ({ ...current, vat_period_id: value }))} options={periods.map((period) => ({ value: period.id, label: `${formatDate(period.start_date)} - ${formatDate(period.end_date)}` }))} />
            <VatSelect label="VAT code" value={adjustmentForm.vat_code} onChange={(value) => setAdjustmentForm((current) => ({ ...current, vat_code: value }))} options={activeCodes.map((code) => ({ value: code.code, label: `${code.code} - ${code.description}` }))} />
            <Field label="Reason" value={adjustmentForm.reason} onChange={(value) => setAdjustmentForm((current) => ({ ...current, reason: value }))} />
            <Field label="Net" type="number" value={adjustmentForm.net_amount} onChange={(value) => setAdjustmentForm((current) => ({ ...current, net_amount: value }))} />
            <Field label="VAT" type="number" value={adjustmentForm.vat_amount} onChange={(value) => setAdjustmentForm((current) => ({ ...current, vat_amount: value }))} />
            <Field label="Gross" type="number" value={adjustmentForm.gross_amount} onChange={(value) => setAdjustmentForm((current) => ({ ...current, gross_amount: value }))} />
            <Field label="Notes" value={adjustmentForm.notes} onChange={(value) => setAdjustmentForm((current) => ({ ...current, notes: value }))} />
            <Button disabled={busy} className="w-full" style={{ background: "var(--brand)" }}>Post VAT adjustment</Button>
          </form>
        </Panel>
      </div>
    );
  }

  if (tab === "Reports") {
    return <VatReportsWorkspace vat={vat} transactions={transactions} />;
  }

  if (tab === "Settings") {
    return (
      <Panel title="VAT settings">
        <form onSubmit={saveSettings} className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Field label="VAT registration number" value={settingsForm.vat_registration_number || ""} onChange={(value) => setSettingsForm((current) => ({ ...current, vat_registration_number: value }))} />
            <VatSelect label="VAT scheme" value={settingsForm.vat_scheme || "standard"} onChange={(value) => setSettingsForm((current) => ({ ...current, vat_scheme: value }))} options={["standard", "cash", "flat_rate"]} />
            <VatSelect label="VAT frequency" value={settingsForm.vat_frequency || "quarterly"} onChange={(value) => setSettingsForm((current) => ({ ...current, vat_frequency: value }))} options={["monthly", "quarterly", "annual"]} />
            <Field label="VAT start date" type="date" value={settingsForm.vat_start_date || ""} onChange={(value) => setSettingsForm((current) => ({ ...current, vat_start_date: value }))} />
            <VatSelect label="Default purchase VAT code" value={settingsForm.default_purchase_vat_code || ""} onChange={(value) => setSettingsForm((current) => ({ ...current, default_purchase_vat_code: value }))} options={activeCodes.map((code) => ({ value: code.code, label: `${code.code} - ${code.description}` }))} />
            <VatSelect label="Default sales VAT code" value={settingsForm.default_sales_vat_code || ""} onChange={(value) => setSettingsForm((current) => ({ ...current, default_sales_vat_code: value }))} options={activeCodes.map((code) => ({ value: code.code, label: `${code.code} - ${code.description}` }))} />
            <VatSelect label="Default bank VAT code" value={settingsForm.default_bank_vat_code || ""} onChange={(value) => setSettingsForm((current) => ({ ...current, default_bank_vat_code: value }))} options={activeCodes.map((code) => ({ value: code.code, label: `${code.code} - ${code.description}` }))} />
            <Field label="Flat rate percentage" type="number" value={settingsForm.flat_rate_percentage || ""} onChange={(value) => setSettingsForm((current) => ({ ...current, flat_rate_percentage: value }))} />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <VatCheckbox label="Cash accounting" checked={!!settingsForm.cash_accounting} onChange={(value) => setSettingsForm((current) => ({ ...current, cash_accounting: value, accrual_accounting: !value }))} />
            <VatCheckbox label="Accrual accounting" checked={settingsForm.accrual_accounting !== false} onChange={(value) => setSettingsForm((current) => ({ ...current, accrual_accounting: value, cash_accounting: !value }))} />
            <VatCheckbox label="MTD ready" checked={!!settingsForm.mtd_enabled} onChange={(value) => setSettingsForm((current) => ({ ...current, mtd_enabled: value }))} />
          </div>
          <div className="flex justify-end">
            <Button disabled={busy} style={{ background: "var(--brand)" }}>Save VAT settings</Button>
          </div>
        </form>
      </Panel>
    );
  }

  return <PlaceholderModulePanel title={tab} moduleTitle="VAT" />;
}

function VatAccountingFilterBar({ search, setSearch, extra }) {
  return (
    <div className="mb-3 flex flex-col gap-2 rounded-md border border-stone-200 bg-stone-50 p-2 lg:flex-row lg:items-center">
      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search VAT audit trail" className="h-9 lg:max-w-md" />
      {extra}
      <div className="ml-auto flex gap-2">
        <Button type="button" variant="outline" size="sm" className="gap-2"><RefreshCw className="h-4 w-4" />Refresh</Button>
        <Button type="button" variant="outline" size="sm" className="gap-2"><Download className="h-4 w-4" />Export</Button>
        <Button type="button" variant="outline" size="sm" className="gap-2"><Printer className="h-4 w-4" />Print</Button>
      </div>
    </div>
  );
}

function VatBoxGrid({ boxes = {}, transactions = [], onOpenBox }) {
  const rows = Array.from({ length: 9 }, (_, index) => {
    const box = `box${index + 1}`;
    const value = boxes[box] || 0;
    const count = vatBoxTransactions(box, transactions).length;
    return { box, label: vatBoxLabel(box), value, count };
  });
  return (
    <div className="grid gap-2 md:grid-cols-3">
      {rows.map((row) => (
        <button key={row.box} type="button" onClick={() => onOpenBox(row.box)} className="rounded-md border border-stone-200 bg-white p-3 text-left shadow-sm transition hover:border-emerald-300 hover:shadow-md">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{row.box.toUpperCase()}</p>
          <p className="mt-1 text-sm font-medium text-stone-700">{row.label}</p>
          <p className="mt-3 font-display text-xl font-bold text-stone-900">{formatMoney(row.value)}</p>
          <p className="text-xs text-stone-500">{row.count} source transaction{row.count === 1 ? "" : "s"}</p>
        </button>
      ))}
    </div>
  );
}

function VatBoxDrilldown({ box, transactions, onClose }) {
  const rows = vatBoxTransactions(box, transactions);
  return (
    <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-emerald-950">{box.toUpperCase()} drill-down</p>
          <p className="text-xs text-emerald-800">{vatBoxLabel(box)}</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onClose}>Close</Button>
      </div>
      <VatTransactionsTable transactions={rows} compact />
    </div>
  );
}

function vatBoxTransactions(box, transactions = []) {
  return transactions.filter((transaction) => String(transaction.return_box_vat || "") === box.replace("box", "") || String(transaction.return_box_net || "") === box.replace("box", ""));
}

function vatBoxLabel(box) {
  const labels = {
    box1: "VAT due on sales",
    box2: "VAT due on acquisitions",
    box3: "Total VAT due",
    box4: "VAT reclaimed",
    box5: "Net VAT due",
    box6: "Net sales",
    box7: "Net purchases",
    box8: "EC sales",
    box9: "EC purchases",
  };
  return labels[box] || box;
}

function VatTransactionsTable({ transactions = [], compact = false }) {
  if (!transactions.length) {
    return <p className="py-8 text-center text-sm text-stone-500">No VAT transactions found.</p>;
  }
  return (
    <div className="overflow-auto rounded-md border border-stone-200 bg-white">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
          <tr>
            <th className="px-3 py-2">Date</th>
            {!compact && <th className="px-3 py-2">Source</th>}
            <th className="px-3 py-2">Document</th>
            {!compact && <th className="px-3 py-2">Account</th>}
            <th className="px-3 py-2">VAT code</th>
            <th className="px-3 py-2 text-right">Net</th>
            <th className="px-3 py-2 text-right">VAT</th>
            <th className="px-3 py-2 text-right">Gross</th>
            {!compact && <th className="px-3 py-2">Period</th>}
            {!compact && <th className="px-3 py-2">Status</th>}
          </tr>
        </thead>
        <tbody>
          {transactions.map((transaction) => (
            <tr key={transaction.id} className="border-t border-stone-100">
              <td className="whitespace-nowrap px-3 py-2">{formatDate(transaction.date)}</td>
              {!compact && <td className="px-3 py-2 text-stone-600">{transaction.source_module}</td>}
              <td className="px-3 py-2 font-medium text-stone-900">{transaction.document_number || transaction.document_type}</td>
              {!compact && <td className="px-3 py-2 text-stone-600">{transaction.account_name || transaction.account_code || "-"}</td>}
              <td className="px-3 py-2"><Badge variant="outline">{transaction.vat_code || "-"}</Badge></td>
              <td className="px-3 py-2 text-right">{formatMoney(transaction.net)}</td>
              <td className="px-3 py-2 text-right">{formatMoney(transaction.vat)}</td>
              <td className="px-3 py-2 text-right">{formatMoney(transaction.gross)}</td>
              {!compact && <td className="px-3 py-2 text-stone-500">{transaction.vat_period || "-"}</td>}
              {!compact && <td className="px-3 py-2"><Badge className={transaction.status === "locked" ? "bg-stone-200 text-stone-700" : "bg-emerald-100 text-emerald-800"}>{transaction.status || "open"}</Badge></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VatCodeTable({ codes = [] }) {
  if (!codes.length) {
    return <p className="py-10 text-center text-sm text-stone-500">No VAT codes configured yet.</p>;
  }
  return (
    <div className="overflow-auto rounded-md border border-stone-200 bg-white">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
          <tr>
            <th className="px-3 py-2">Code</th>
            <th className="px-3 py-2">Description</th>
            <th className="px-3 py-2 text-right">Rate</th>
            <th className="px-3 py-2">Purchase</th>
            <th className="px-3 py-2">Sales</th>
            <th className="px-3 py-2">Boxes</th>
            <th className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {codes.map((code) => (
            <tr key={code.id || code.code} className="border-t border-stone-100">
              <td className="px-3 py-2 font-semibold text-stone-900">{code.code}</td>
              <td className="px-3 py-2 text-stone-700">{code.description}</td>
              <td className="px-3 py-2 text-right">{Number(code.percentage || 0).toFixed(2)}%</td>
              <td className="px-3 py-2 text-stone-600">{code.purchase_behavior}</td>
              <td className="px-3 py-2 text-stone-600">{code.sales_behavior}</td>
              <td className="px-3 py-2 text-stone-600">Net {code.return_box_net || "-"} / VAT {code.return_box_vat || "-"}</td>
              <td className="px-3 py-2"><Badge className={code.active ? "bg-emerald-100 text-emerald-800" : "bg-stone-200 text-stone-700"}>{code.active ? "Active" : "Inactive"}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VatPeriodTable({ periods = [], onAction, busy }) {
  if (!periods.length) {
    return <p className="py-10 text-center text-sm text-stone-500">No VAT periods configured yet.</p>;
  }
  return (
    <div className="overflow-auto rounded-md border border-stone-200 bg-white">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
          <tr>
            <th className="px-3 py-2">Period</th>
            <th className="px-3 py-2">Due</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2 text-right">Transactions</th>
            <th className="px-3 py-2 text-right">Output VAT</th>
            <th className="px-3 py-2 text-right">Input VAT</th>
            <th className="px-3 py-2 text-right">Net VAT</th>
            <th className="px-3 py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {periods.map((period) => (
            <tr key={period.id} className="border-t border-stone-100">
              <td className="px-3 py-2 font-semibold text-stone-900">{formatDate(period.start_date)} - {formatDate(period.end_date)}</td>
              <td className="px-3 py-2">{formatDate(period.due_date)}</td>
              <td className="px-3 py-2"><Badge variant="outline" className="capitalize">{period.status}</Badge></td>
              <td className="px-3 py-2 text-right">{period.transaction_count || 0}</td>
              <td className="px-3 py-2 text-right">{formatMoney(period.output_vat)}</td>
              <td className="px-3 py-2 text-right">{formatMoney(period.input_vat)}</td>
              <td className="px-3 py-2 text-right font-semibold">{formatMoney(period.net_vat)}</td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {["open", "locked", "closed"].filter((action) => action !== period.status).map((action) => (
                    <Button key={action} type="button" size="sm" variant="outline" disabled={busy} onClick={() => onAction(period, action)} className="capitalize">{action}</Button>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VatReportsWorkspace({ vat, transactions }) {
  const reports = vat.reports || {};
  const exceptions = reports.exceptions || [];
  const cards = [
    ["VAT Return Summary", formatMoney(vat?.current_boxes?.box5 || 0), "Net VAT due for the current open period."],
    ["VAT Detail Report", transactions.length, "Detailed VAT transaction audit trail."],
    ["VAT Audit Report", reports.audit_count || transactions.length, "VAT postings, adjustments and return actions."],
    ["VAT by Nominal", Object.keys(reports.by_nominal || {}).length, "Nominal account VAT totals."],
    ["VAT by Supplier", Object.keys(reports.by_supplier || {}).length, "Purchase VAT by supplier."],
    ["VAT by Customer", Object.keys(reports.by_customer || {}).length, "Sales VAT by customer."],
    ["VAT Exception Report", exceptions.length, "Transactions that need review."],
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {cards.map(([title, value, text]) => (
          <div key={title} className="rounded-md border border-stone-200 bg-white p-4 shadow-sm">
            <p className="font-semibold text-stone-900">{title}</p>
            <p className="mt-2 font-display text-2xl font-bold text-stone-900">{value}</p>
            <p className="mt-1 text-sm text-stone-500">{text}</p>
          </div>
        ))}
      </div>
      <Panel title="VAT exceptions">
        {exceptions.length === 0 ? (
          <p className="py-8 text-center text-sm text-stone-500">No VAT exceptions found.</p>
        ) : (
          <VatTransactionsTable transactions={exceptions} />
        )}
      </Panel>
    </div>
  );
}

function VatSelect({ label, value, onChange, options = [] }) {
  const normalised = options.map((option) => typeof option === "string" ? { value: option, label: option } : option);
  return (
    <div>
      <Label className="text-xs font-semibold text-stone-600">{label}</Label>
      <select value={value || ""} onChange={(e) => onChange(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm">
        <option value="">Select</option>
        {normalised.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  );
}

function VatCheckbox({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-3 rounded-md border border-stone-200 bg-white p-3 text-sm font-semibold text-stone-700 shadow-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
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

function AIAccountingWorkspace({ workspace, activeTab }) {
  const ai = workspace?.ai_workspace || {};
  const tab = activeTab || "Overview";
  if (tab === "Tasks") return <AIWorkQueue ai={ai} />;
  if (tab === "Insights") return <AIInsights ai={ai} />;
  if (tab === "Exceptions") return <AIExceptions ai={ai} />;
  if (tab === "Approvals") return <AIApprovals ai={ai} />;
  if (tab === "Deadlines") return <AIDeadlines ai={ai} />;
  if (tab === "Health Check") return <AIHealthCheck ai={ai} />;
  if (tab === "AI Assistant") return <AIAssistant ai={ai} />;
  if (tab === "Settings") return <AIWorkspaceSettings ai={ai} />;
  return <AIOverview ai={ai} workspace={workspace} />;
}

function AIOverview({ ai }) {
  return (
    <div className="space-y-4">
      <AIKpiGrid kpis={ai.kpis} />
      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <AIWorkQueue ai={ai} compact />
        <AIHealthCheck ai={ai} compact />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <AIInsights ai={ai} compact />
        <AINotifications ai={ai} />
      </div>
      <AIGlobalSearch ai={ai} />
    </div>
  );
}

function AIKpiGrid({ kpis }) {
  const rows = Array.isArray(kpis) ? kpis : [];
  return (
    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
      {rows.map((item) => (
        <button key={item.label} type="button" className="rounded-md border border-stone-200 bg-white p-4 text-left shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/40">
          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
            <Sparkles className="h-3.5 w-3.5 text-emerald-700" /> {item.module}
          </span>
          <span className="mt-3 block text-2xl font-bold text-stone-900">{formatMaybeMoney(item.value)}</span>
          <span className="mt-1 block text-sm text-stone-600">{item.label}</span>
        </button>
      ))}
      {!rows.length && <EmptyAIState title="No AI workspace data yet" detail="Open a native accounting client with activity to populate the command centre." />}
    </div>
  );
}

function AIWorkQueue({ ai, compact = false }) {
  const groups = [
    ["high", "High", "border-red-200 bg-red-50 text-red-800"],
    ["medium", "Medium", "border-amber-200 bg-amber-50 text-amber-800"],
    ["low", "Low", "border-stone-200 bg-stone-50 text-stone-700"],
  ];
  return (
    <Panel title={compact ? "My Work Queue" : "My Work Queue"}>
      <div className="grid gap-3">
        {groups.map(([key, label, tone]) => {
          const rows = Array.isArray(ai.work_queue?.[key]) ? ai.work_queue[key] : [];
          return (
            <section key={key} className="rounded-md border border-stone-200 bg-white">
              <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
                <span className={`rounded-full border px-3 py-1 text-xs font-bold ${tone}`}>{label}</span>
                <span className="text-xs font-semibold text-stone-500">{rows.length} tasks</span>
              </div>
              <div className="divide-y divide-stone-100">
                {rows.slice(0, compact ? 3 : 50).map((item) => (
                  <div key={item.id || item.title} className="flex flex-col gap-2 p-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="font-semibold text-stone-900">{item.title}</p>
                      <p className="mt-1 text-sm text-stone-500">{item.detail}</p>
                      <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-emerald-800">{item.module}</p>
                    </div>
                    <Button variant="outline" size="sm" className="shrink-0">{item.action}</Button>
                  </div>
                ))}
                {!rows.length && <div className="p-4 text-sm text-stone-500">No {label.toLowerCase()} priority tasks.</div>}
              </div>
            </section>
          );
        })}
      </div>
    </Panel>
  );
}

function AIInsights({ ai, compact = false }) {
  const rows = Array.isArray(ai.insights) ? ai.insights : [];
  return (
    <Panel title="Insights">
      <div className="grid gap-3">
        {rows.slice(0, compact ? 4 : 50).map((item) => (
          <div key={`${item.module}-${item.title}`} className={`rounded-md border p-4 ${item.tone === "warning" ? "border-amber-200 bg-amber-50" : item.tone === "success" ? "border-emerald-200 bg-emerald-50" : "border-stone-200 bg-white"}`}>
            <div className="flex items-start gap-3">
              {item.tone === "warning" ? <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-700" /> : <Activity className="mt-0.5 h-5 w-5 text-emerald-700" />}
              <div>
                <p className="font-semibold text-stone-900">{item.title}</p>
                <p className="mt-1 text-sm text-stone-600">{item.detail}</p>
                <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-stone-500">{item.module}</p>
              </div>
            </div>
          </div>
        ))}
        {!rows.length && <EmptyAIState title="No insights" detail="Rule-based insights will appear as accounting data changes." />}
      </div>
    </Panel>
  );
}

function AIExceptions({ ai }) {
  return (
    <Panel title="Exceptions">
      <ReportTable
        rows={ai.exceptions}
        empty="No exceptions detected."
        columns={[
          { key: "severity", label: "Severity" },
          { key: "module", label: "Module" },
          { key: "type", label: "Type" },
          { key: "reference", label: "Reference" },
          { key: "detail", label: "Detail" },
        ]}
      />
    </Panel>
  );
}

function AIApprovals({ ai }) {
  return (
    <Panel title="Approvals">
      <ReportTable
        rows={ai.approvals}
        empty="No approvals waiting."
        columns={[
          { key: "date", label: "Date", type: "date" },
          { key: "module", label: "Module" },
          { key: "record_type", label: "Record" },
          { key: "reference", label: "Reference" },
          { key: "contact", label: "Contact" },
          { key: "amount", label: "Amount", type: "money" },
          { key: "status", label: "Status" },
        ]}
      />
    </Panel>
  );
}

function AIDeadlines({ ai }) {
  return (
    <Panel title="Deadlines">
      <ReportTable
        rows={ai.deadlines}
        empty="No upcoming accounting deadlines."
        columns={[
          { key: "module", label: "Module" },
          { key: "title", label: "Deadline" },
          { key: "start_date", label: "Start", type: "date" },
          { key: "due_date", label: "Due", type: "date" },
          { key: "days", label: "Days" },
          { key: "status", label: "Status" },
        ]}
      />
    </Panel>
  );
}

function AIHealthCheck({ ai, compact = false }) {
  const health = ai.health_check || {};
  const score = Number(health.score || 0);
  return (
    <Panel title="Health Check">
      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <div className="rounded-md border border-stone-200 bg-white p-5 text-center">
          <Gauge className="mx-auto h-8 w-8 text-emerald-700" />
          <p className="mt-3 text-4xl font-bold text-stone-900">{score}</p>
          <p className="text-sm text-stone-500">Accounting health score</p>
          <div className="mt-4 h-2 rounded-full bg-stone-100">
            <div className="h-2 rounded-full bg-emerald-600" style={{ width: `${Math.min(100, Math.max(0, score))}%` }} />
          </div>
        </div>
        <div className="grid gap-3">
          {(Array.isArray(health.categories) ? health.categories : []).slice(0, compact ? 4 : 50).map((item) => (
            <div key={item.area} className="rounded-md border border-stone-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-stone-900">{item.area}</p>
                  <p className="text-sm text-stone-500">{item.status}</p>
                </div>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-800">{item.score}/100</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function AIAssistant({ ai }) {
  const questions = Array.isArray(ai.assistant?.suggested_questions) ? ai.assistant.suggested_questions : [];
  const answers = ai.assistant?.answers || {};
  const [question, setQuestion] = useState(questions[0] || "");
  const answer = answers[question] || "This assistant is rule-based at the moment. Choose a suggested question to inspect the current accounting workspace.";
  return (
    <Panel title="AI Assistant">
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="rounded-md border border-stone-200 bg-stone-50 p-4">
          <p className="text-sm font-semibold text-stone-700">Suggested questions</p>
          <div className="mt-3 grid gap-2">
            {questions.map((item) => (
              <button key={item} type="button" onClick={() => setQuestion(item)} className={`rounded-md px-3 py-2 text-left text-sm font-semibold ${question === item ? "bg-[var(--brand)] text-white" : "bg-white text-stone-700 hover:bg-stone-100"}`}>
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-md border border-emerald-100 bg-emerald-50 p-5">
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-emerald-800">
            <MessageSquare className="h-4 w-4" /> Rule-based answer
          </div>
          <h3 className="mt-4 font-display text-xl font-bold text-stone-900">{question || "Ask a question"}</h3>
          <p className="mt-3 text-stone-700">{answer}</p>
        </div>
      </div>
    </Panel>
  );
}

function AIGlobalSearch({ ai }) {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const index = Array.isArray(ai.global_search?.index) ? ai.global_search.index : [];
    if (!q) return index.slice(0, 12);
    return index.filter((item) => Object.values(item).join(" ").toLowerCase().includes(q)).slice(0, 25);
  }, [ai.global_search, query]);
  return (
    <Panel title="Global Search">
      <div className="mb-3 flex gap-2">
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customers, suppliers, invoices, journals, bank transactions or VAT returns" />
        <Button variant="outline"><RefreshCw className="mr-2 h-4 w-4" /> Refresh</Button>
      </div>
      <ReportTable
        rows={rows}
        empty="No matching accounting records."
        columns={[
          { key: "type", label: "Type" },
          { key: "module", label: "Module" },
          { key: "label", label: "Record" },
          { key: "reference", label: "Reference" },
          { key: "amount", label: "Amount", type: "money" },
        ]}
        compact
      />
    </Panel>
  );
}

function AINotifications({ ai }) {
  const rows = Array.isArray(ai.notifications) ? ai.notifications : [];
  return (
    <Panel title="Notifications">
      <div className="grid gap-3">
        {rows.map((item, index) => (
          <div key={`${item.title || item.type}-${index}`} className="flex items-start gap-3 rounded-md border border-stone-200 bg-white p-4">
            <ClipboardCheck className="mt-0.5 h-5 w-5 text-emerald-700" />
            <div>
              <p className="font-semibold text-stone-900">{item.title || item.type}</p>
              <p className="mt-1 text-sm text-stone-500">{item.detail}</p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-stone-500">{item.module}</p>
            </div>
          </div>
        ))}
        {!rows.length && <EmptyAIState title="No notifications" detail="Urgent tasks and exceptions will appear here." />}
      </div>
    </Panel>
  );
}

function AIWorkspaceSettings({ ai }) {
  const settings = ai.settings || {};
  return (
    <Panel title="AI Workspace Settings">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-md border border-stone-200 bg-white p-4">
          <Label>Default landing tab</Label>
          <Input value={settings.default_landing_tab || "Overview"} readOnly className="mt-2" />
        </div>
        <div className="rounded-md border border-stone-200 bg-white p-4">
          <Label>Assistant mode</Label>
          <Input value={settings.assistant_mode || "Rule-based"} readOnly className="mt-2" />
        </div>
        <div className="rounded-md border border-stone-200 bg-white p-4 md:col-span-2">
          <Label>Visible KPI cards</Label>
          <div className="mt-3 flex flex-wrap gap-2">
            {(Array.isArray(settings.kpi_visibility) ? settings.kpi_visibility : []).map((item) => <Badge key={item} variant="secondary">{item}</Badge>)}
          </div>
        </div>
        <div className="rounded-md border border-stone-200 bg-white p-4 md:col-span-2">
          <Label>Work queue priorities</Label>
          <div className="mt-3 flex flex-wrap gap-2">
            {(Array.isArray(settings.work_queue_priorities) ? settings.work_queue_priorities : []).map((item) => <Badge key={item}>{item}</Badge>)}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function EmptyAIState({ title, detail }) {
  return (
    <div className="rounded-md border border-dashed border-stone-200 bg-stone-50 p-6 text-center text-sm text-stone-500">
      <CheckCircle2 className="mx-auto mb-2 h-5 w-5 text-emerald-700" />
      <p className="font-semibold text-stone-800">{title}</p>
      <p className="mt-1">{detail}</p>
    </div>
  );
}

function formatMaybeMoney(value) {
  if (typeof value === "number") return value;
  const text = String(value ?? "");
  if (/^-?\d+(\.\d+)?$/.test(text)) return formatMoney(text);
  return text || "-";
}

function ReportsWorkspace({ workspace, activeReport }) {
  const reports = workspace.reports || {};
  if (activeReport === "Financial Statements") return <FinancialStatementsWorkspace workspace={workspace} />;
  if (activeReport === "Management Reports") return <ManagementReportsWorkspace reports={reports} />;
  if (activeReport === "VAT Reports") return <VatReportSuite reports={reports} />;
  if (activeReport === "Sales Reports") return <SalesReportSuite reports={reports} />;
  if (activeReport === "Purchase Reports") return <PurchaseReportSuite reports={reports} />;
  if (activeReport === "Bank Reports") return <BankReportSuite reports={reports} />;
  if (activeReport === "Custom Reports") return <CustomReportsWorkspace reports={reports} />;
  if (activeReport === "Report Scheduler") return <ReportSchedulerWorkspace reports={reports} />;
  if (activeReport === "Exports") return <ReportExportsWorkspace reports={reports} />;
  if (activeReport === "Settings") return <ReportSettingsWorkspace reports={reports} />;
  return <ReportsDashboard reports={reports} />;
}

function ReportsDashboard({ reports }) {
  const dashboard = reports.dashboard || {};
  const workingCapital = dashboard.working_capital || {};
  return (
    <div className="space-y-4">
      <ReportActionBar title="Reporting dashboard" rows={dashboard.recent_activity || []} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Revenue this month" value={formatMoney(dashboard.revenue_this_month)} tone="emerald" />
        <SummaryCard label="Expenses this month" value={formatMoney(dashboard.expenses_this_month)} tone="amber" />
        <SummaryCard label="Gross profit" value={formatMoney(dashboard.gross_profit)} tone="blue" />
        <SummaryCard label="Net profit" value={formatMoney(dashboard.net_profit)} tone="stone" />
        <SummaryCard label="Cash at bank" value={formatMoney(dashboard.cash_at_bank)} tone="emerald" />
        <SummaryCard label="VAT liability" value={formatMoney(dashboard.vat_liability)} tone="amber" />
        <SummaryCard label="Accounts receivable" value={formatMoney(dashboard.accounts_receivable)} tone="blue" />
        <SummaryCard label="Accounts payable" value={formatMoney(dashboard.accounts_payable)} tone="stone" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
        <Panel title="Financial performance">
          <ReportTable
            rows={dashboard.financial_performance || []}
            columns={[
              ["period", "Period"],
              ["income", "Revenue", "money"],
              ["expenses", "Expenses", "money"],
              ["profit", "Profit", "money"],
            ]}
            empty="No posted transactions yet."
          />
        </Panel>
        <Panel title="Working capital">
          <ReportRows rows={[
            ["Debtors", workingCapital.debtors],
            ["Creditors", workingCapital.creditors],
            ["Cash", workingCapital.cash],
            ["Net working capital", workingCapital.net_working_capital],
          ]} />
        </Panel>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Cash position">
          <ReportTable rows={dashboard.bank_balances || []} columns={[["account_name", "Bank account"], ["current_balance", "Balance", "money"], ["reconciled_balance", "Reconciled", "money"]]} empty="No bank accounts configured." />
        </Panel>
        <Panel title="Recent financial activity">
          <ReportTable rows={dashboard.recent_activity || []} columns={[["date", "Date", "date"], ["module", "Module"], ["reference", "Reference"], ["amount", "Amount", "money"]]} empty="No recent postings yet." />
        </Panel>
      </div>
    </div>
  );
}

function FinancialStatementsWorkspace({ workspace }) {
  const reports = workspace.reports || {};
  const pnl = reports.profit_and_loss || {};
  const balanceSheet = reports.balance_sheet || {};
  const cashFlow = reports.cash_flow || {};
  const equity = reports.statement_of_changes_in_equity || {};
  return (
    <div className="space-y-4">
      <ReportActionBar title="Financial statements" rows={reports.trial_balance || []} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Profit and Loss">
          <ReportRows rows={[["Income", pnl.income], ["Expenses", pnl.expenses], ["Gross profit", pnl.gross_profit], ["Net profit / loss", pnl.profit]]} />
          <ExpandableReportRows title="Income detail" rows={pnl.sections?.income || []} />
          <ExpandableReportRows title="Expense detail" rows={pnl.sections?.expenses || []} />
        </Panel>
        <Panel title="Balance Sheet">
          <ReportRows rows={[["Assets", balanceSheet.assets], ["Liabilities", balanceSheet.liabilities], ["Equity", balanceSheet.equity], ["Current year profit", balanceSheet.current_year_profit], ["Net assets", balanceSheet.net_assets]]} />
          <ExpandableReportRows title="Asset detail" rows={balanceSheet.sections?.assets || []} />
          <ExpandableReportRows title="Liability detail" rows={balanceSheet.sections?.liabilities || []} />
          <ExpandableReportRows title="Equity detail" rows={balanceSheet.sections?.equity || []} />
        </Panel>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Cash Flow Statement">
          <ReportRows rows={[["Operating activities", cashFlow.operating_activities], ["Investing activities", cashFlow.investing_activities], ["Financing activities", cashFlow.financing_activities], ["Net cash movement", cashFlow.net_cash_movement]]} />
        </Panel>
        <Panel title="Statement of Changes in Equity">
          <ReportRows rows={[["Opening equity", equity.opening_equity], ["Current year profit", equity.current_year_profit], ["Closing equity", equity.closing_equity]]} />
        </Panel>
      </div>
      <TrialBalanceReport workspace={workspace} />
    </div>
  );
}

function ManagementReportsWorkspace({ reports }) {
  const management = reports.management || {};
  return (
    <div className="space-y-4">
      <ReportActionBar title="Management reports" rows={management.monthly_performance || []} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Income vs Expenses">
          <ReportTable rows={management.income_vs_expenses || []} columns={[["period", "Period"], ["income", "Income", "money"], ["expenses", "Expenses", "money"], ["profit", "Profit", "money"]]} empty="No transactions to compare yet." />
        </Panel>
        <Panel title="KPI summary">
          <ReportRows rows={[["Gross margin", management.kpi_summary?.gross_margin], ["Net margin", management.kpi_summary?.net_margin], ["Working capital", management.kpi_summary?.working_capital]]} />
        </Panel>
      </div>
      <Panel title="Trend analysis">
        <ReportTable rows={management.trend_analysis || []} columns={[["period", "Period"], ["income", "Revenue", "money"], ["expenses", "Expenses", "money"], ["profit", "Net profit", "money"]]} empty="No trend data yet." />
      </Panel>
      <Panel title="Department summary">
        <p className="py-6 text-center text-sm text-stone-500">Department and cost-centre reporting is ready for future dimensions once departments are enabled.</p>
      </Panel>
    </div>
  );
}

function VatReportSuite({ reports }) {
  const vat = reports.vat_reports || {};
  const boxes = vat.return_summary || {};
  return (
    <div className="space-y-4">
      <ReportActionBar title="VAT reports" rows={vat.detail || []} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="VAT Return Summary">
          <ReportRows rows={[
            ["Box 1 - VAT due on sales", boxes.box1],
            ["Box 2 - VAT due on acquisitions", boxes.box2],
            ["Box 3 - Total VAT due", boxes.box3],
            ["Box 4 - VAT reclaimed", boxes.box4],
            ["Box 5 - Net VAT", boxes.box5],
            ["Box 6 - Net sales", boxes.box6],
            ["Box 7 - Net purchases", boxes.box7],
            ["Box 8 - EC sales", boxes.box8],
            ["Box 9 - EC purchases", boxes.box9],
          ]} />
        </Panel>
        <Panel title="VAT by Code">
          <ReportTable rows={vat.by_code || []} columns={[["vat_code", "VAT code"], ["transactions", "Transactions"], ["net", "Net", "money"], ["vat", "VAT", "money"], ["gross", "Gross", "money"]]} empty="No VAT movements yet." />
        </Panel>
      </div>
      <Panel title="VAT Detail">
        <ReportTable rows={vat.detail || []} columns={[["date", "Date", "date"], ["source_module", "Module"], ["document_number", "Document"], ["vat_code", "VAT code"], ["net", "Net", "money"], ["vat", "VAT", "money"], ["gross", "Gross", "money"]]} empty="No VAT transactions yet." />
      </Panel>
      <Panel title="VAT Exceptions">
        <ReportTable rows={vat.exceptions || []} columns={[["date", "Date", "date"], ["document_number", "Document"], ["vat_code", "VAT code"], ["net", "Net", "money"], ["vat", "VAT", "money"]]} empty="No VAT exceptions found." />
      </Panel>
    </div>
  );
}

function SalesReportSuite({ reports }) {
  const sales = reports.sales_reports || {};
  return (
    <div className="space-y-4">
      <ReportActionBar title="Sales reports" rows={sales.sales_analysis || []} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Customer Sales">
          <ReportTable rows={sales.customer_sales || []} columns={[["customer", "Customer"], ["invoice_count", "Invoices"], ["outstanding", "Outstanding", "money"]]} empty="No customer sales yet." />
        </Panel>
        <AgedBalanceTable title="Aged debtors" rows={sales.aged_debtors || []} empty="No debtor balances yet." />
      </div>
      <Panel title="Invoice Analysis">
        <ReportTable rows={sales.invoice_analysis || []} columns={[["invoice_number", "Invoice"], ["customer_name", "Customer"], ["invoice_date", "Date", "date"], ["gross_amount", "Gross", "money"], ["outstanding_amount", "Outstanding", "money"], ["status", "Status"]]} empty="No sales invoices yet." />
      </Panel>
      <Panel title="Receipts Analysis">
        <ReportTable rows={sales.receipts_analysis || []} columns={[["receipt_date", "Date", "date"], ["customer_name", "Customer"], ["amount", "Amount", "money"], ["payment_method", "Method"], ["status", "Status"]]} empty="No customer receipts yet." />
      </Panel>
    </div>
  );
}

function PurchaseReportSuite({ reports }) {
  const purchases = reports.purchase_reports || {};
  return (
    <div className="space-y-4">
      <ReportActionBar title="Purchase reports" rows={purchases.purchase_analysis || []} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Supplier Spend">
          <ReportTable rows={purchases.supplier_spend || []} columns={[["supplier", "Supplier"], ["invoice_count", "Invoices"], ["outstanding", "Outstanding", "money"]]} empty="No supplier spend yet." />
        </Panel>
        <AgedBalanceTable title="Aged creditors" rows={purchases.aged_creditors || []} empty="No creditor balances yet." />
      </div>
      <Panel title="Outstanding Bills">
        <ReportTable rows={purchases.outstanding_bills || []} columns={[["invoice_number", "Bill"], ["supplier_name", "Supplier"], ["invoice_date", "Date", "date"], ["gross_amount", "Gross", "money"], ["outstanding_amount", "Outstanding", "money"], ["status", "Status"]]} empty="No outstanding bills." />
      </Panel>
      <Panel title="Purchase VAT">
        <ReportTable rows={purchases.purchase_vat || []} columns={[["date", "Date", "date"], ["document_number", "Document"], ["vat_code", "VAT code"], ["net", "Net", "money"], ["vat", "VAT", "money"], ["gross", "Gross", "money"]]} empty="No purchase VAT yet." />
      </Panel>
    </div>
  );
}

function BankReportSuite({ reports }) {
  const bank = reports.bank_reports || {};
  return (
    <div className="space-y-4">
      <ReportActionBar title="Bank reports" rows={bank.bank_activity || []} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Bank Balances">
          <ReportTable rows={bank.balances || []} columns={[["account_name", "Bank account"], ["current_balance", "Current", "money"], ["reconciled_balance", "Reconciled", "money"]]} empty="No bank accounts configured." />
        </Panel>
        <Panel title="Outstanding Transactions">
          <ReportTable rows={bank.outstanding_transactions || []} columns={[["transaction_date", "Date", "date"], ["description", "Description"], ["amount", "Amount", "money"], ["suggested_match", "Suggested match"]]} empty="No unreconciled bank items." />
        </Panel>
      </div>
      <Panel title="Cashbook">
        <ReportTable rows={bank.cashbook || []} columns={[["transaction_date", "Date", "date"], ["description", "Description"], ["reference", "Reference"], ["money_in", "Money in", "money"], ["money_out", "Money out", "money"], ["status", "Status"]]} empty="No cashbook activity yet." />
      </Panel>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Bank Charges">
          <ReportTable rows={bank.bank_charges || []} columns={[["transaction_date", "Date", "date"], ["description", "Description"], ["money_out", "Charge", "money"], ["status", "Status"]]} empty="No bank charges posted." />
        </Panel>
        <Panel title="Interest">
          <ReportTable rows={bank.interest || []} columns={[["transaction_date", "Date", "date"], ["description", "Description"], ["money_in", "Interest", "money"], ["status", "Status"]]} empty="No interest transactions posted." />
        </Panel>
      </div>
    </div>
  );
}

function CustomReportsWorkspace({ reports }) {
  const custom = reports.custom_reports || {};
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="Report Builder">
        <div className="grid gap-3 sm:grid-cols-2">
          <Info label="Columns available" value={(custom.available_columns || []).join(", ")} />
          <Info label="Grouping" value={(custom.grouping_options || []).join(", ")} />
          <Info label="Sorting" value={(custom.sorting_options || []).join(", ")} />
          <Info label="Saved reports" value={(custom.saved_reports || []).length} />
        </div>
      </Panel>
      <Panel title="Saved Custom Reports">
        <ReportTable rows={custom.saved_reports || []} columns={[["name", "Name"], ["type", "Type"], ["updated_at", "Updated", "date"]]} empty="No custom reports saved yet." />
      </Panel>
    </div>
  );
}

function ReportSchedulerWorkspace({ reports }) {
  const scheduler = reports.report_scheduler || {};
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="Scheduling Framework">
        <div className="grid gap-3 sm:grid-cols-2">
          <Info label="Frequencies" value={(scheduler.frequencies || []).join(", ")} />
          <Info label="Delivery methods" value={(scheduler.delivery_methods || []).join(", ")} />
        </div>
      </Panel>
      <Panel title="Scheduled Reports">
        <ReportTable rows={scheduler.scheduled_reports || []} columns={[["name", "Report"], ["frequency", "Frequency"], ["next_run", "Next run", "date"], ["status", "Status"]]} empty="No scheduled reports yet." />
      </Panel>
    </div>
  );
}

function ReportExportsWorkspace({ reports }) {
  const exports = reports.exports || {};
  const rows = reports.trial_balance || [];
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="Export Centre">
        <ReportRows rows={[["Supported formats", (exports.formats || []).join(", ")], ["Print layout", exports.print_layout]]} />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="gap-2" onClick={() => window.print()}><Download className="h-4 w-4" /> PDF</Button>
          <Button type="button" variant="outline" className="gap-2" onClick={() => downloadReportCsv("report-export.xls", rows, "application/vnd.ms-excel;charset=utf-8", "\t")}><Download className="h-4 w-4" /> Excel</Button>
          <Button type="button" variant="outline" className="gap-2" onClick={() => downloadReportCsv("report-export.csv", rows)}><Download className="h-4 w-4" /> CSV</Button>
          <Button type="button" variant="outline" className="gap-2" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</Button>
        </div>
      </Panel>
      <Panel title="Generated Exports">
        <ReportTable rows={exports.generated || []} columns={[["created_at", "Created", "date"], ["report", "Report"], ["format", "Format"], ["status", "Status"]]} empty="No generated exports yet." />
      </Panel>
    </div>
  );
}

function ReportSettingsWorkspace({ reports }) {
  const settings = reports.settings || {};
  return (
    <Panel title="Reporting Settings">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Info label="Report basis" value={settings.report_basis} />
        <Info label="Default date range" value={settings.default_date_range} />
        <Info label="Comparative periods" value={settings.comparative_periods ? "Enabled" : "Disabled"} />
        <Info label="Currency" value={settings.currency} />
        <Info label="PDF branding" value={settings.pdf_branding} />
      </div>
    </Panel>
  );
}

function ReportActionBar({ title, rows }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-stone-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 className="font-display text-base font-semibold text-stone-900">{title}</h3>
        <p className="text-xs text-stone-500">Generated from posted accounting transactions and supporting ledgers.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" className="gap-2"><RefreshCw className="h-4 w-4" />Refresh</Button>
        <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => downloadReportCsv(`${title}.csv`, rows || [])}><Download className="h-4 w-4" />CSV</Button>
        <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => downloadReportCsv(`${title}.xls`, rows || [], "application/vnd.ms-excel;charset=utf-8", "\t")}><Download className="h-4 w-4" />Excel</Button>
        <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => window.print()}><Download className="h-4 w-4" />PDF</Button>
        <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => window.print()}><Printer className="h-4 w-4" />Print</Button>
      </div>
    </div>
  );
}

function ExpandableReportRows({ title, rows }) {
  const [openCode, setOpenCode] = useState("");
  const safeRows = Array.isArray(rows) ? rows : [];
  if (!safeRows.length) return null;
  return (
    <div className="mt-3 rounded-md border border-stone-100">
      <div className="bg-stone-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-stone-500">{title}</div>
      <div className="divide-y divide-stone-100">
        {safeRows.map((row) => {
          const isOpen = openCode === row.code;
          return (
            <div key={row.code}>
              <button type="button" onClick={() => setOpenCode(isOpen ? "" : row.code)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-stone-50">
                <span><strong>{row.code}</strong> {row.name}</span>
                <span className="font-semibold">{formatMoney(row.balance)}</span>
              </button>
              {isOpen && <ReportTable rows={row.activity || []} columns={[["date", "Date", "date"], ["reference", "Reference"], ["description", "Description"], ["debit", "Debit", "money"], ["credit", "Credit", "money"]]} empty="No drill-down lines for this account." compact />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReportTable({ rows, columns, empty, compact = false }) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const safeColumns = (Array.isArray(columns) ? columns : []).map((column) => {
    if (Array.isArray(column)) {
      const [key, label, type] = column;
      return { key, label: label || key, type };
    }
    if (column && typeof column === "object") {
      return {
        key: column.key,
        label: column.label || column.key,
        type: column.type,
      };
    }
    return null;
  }).filter((column) => column?.key);

  if (!safeRows.length) return <p className="py-8 text-center text-sm text-stone-500">{empty || "No report rows yet."}</p>;
  if (!safeColumns.length) return <p className="py-8 text-center text-sm text-stone-500">No columns configured for this report.</p>;

  return (
    <div className="overflow-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
          <tr>
            {safeColumns.map(({ key, label }) => <th key={key} className={`px-3 ${compact ? "py-1.5" : "py-2"}`}>{label}</th>)}
          </tr>
        </thead>
        <tbody>
          {safeRows.map((row, index) => (
            <tr key={row.id || row.code || `${row.reference || row.name || row.description || "row"}-${index}`} className="border-t border-stone-100">
              {safeColumns.map(({ key, type }) => (
                <td key={key} className={`px-3 ${compact ? "py-1.5" : "py-2"} ${type === "money" ? "text-right font-medium" : ""}`}>
                  {type === "money" ? formatMoney(row[key]) : type === "date" ? formatDate(row[key]) : row[key] ?? "-"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
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

function formatReportValue(value) {
  if (value === null || value === undefined || value === "") return "-";
  const n = Number(value);
  return Number.isFinite(n) && String(value).trim() !== "" ? formatMoney(value) : String(value);
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

function downloadReportCsv(filename, rows, mimeType = "text/csv;charset=utf-8", delimiter = ",") {
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
