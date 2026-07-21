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
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Gauge,
  MessageSquare,
  Plus,
  RefreshCw,
  Sparkles,
  Printer,
  Download,
  Upload,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import {
  ACCOUNT_CATEGORIES,
  ACCOUNT_PURPOSES,
  ACCOUNT_TYPES,
  MODULES,
  MODULE_DETAILS,
} from "./moduleConfig";
import BankingWorkspace from "./BankingWorkspace";
import AccountsPayableWorkspace from "./AccountsPayableWorkspace";
import AccountsReceivableWorkspace from "./AccountsReceivableWorkspace";
import {
  AccountCodeSelect,
  ContactCount,
  Field,
  Info,
  Panel,
  ReportRows,
  SelectField,
  SummaryCard,
  displayAuditValue,
  downloadReportCsv,
  formatDate,
  formatDateTime,
  formatMoney,
} from "./shared";

const EMPTY_ACCOUNT_FORM = {
  id: "",
  code: "",
  name: "",
  category: "Expense",
  account_type: "Overheads",
  purpose: "Standard Nominal",
  normal_balance: "debit",
  is_control_account: false,
  show_in_banking: false,
  banking_enabled: false,
  active: true,
  description: "",
};

export default function AdminAccountancySoftware() {
  const [clients, setClients] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [workspace, setWorkspace] = useState(null);
  const [module, setModule] = useState(null);
  const [moduleTab, setModuleTab] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [accountForm, setAccountForm] = useState(EMPTY_ACCOUNT_FORM);
  const [accountDrawerMode, setAccountDrawerMode] = useState("");
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [accountBackendMessage, setAccountBackendMessage] = useState("");
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
    setAccountBackendMessage("");
    if (!accountForm.code.trim() || !accountForm.name.trim()) {
      toast.error("Account code and name are required");
      return;
    }
    if ((workspace.accounts || []).some((account) => String(account.code || "").trim().toLowerCase() === accountForm.code.trim().toLowerCase())) {
      toast.error("An account with this code already exists");
      return;
    }
    setBusy(true);
    try {
      const payload = { ...accountForm };
      delete payload.id;
      await api.post(`/admin/accounting/clients/${workspace.client.id}/accounts`, payload);
      toast.success("Account created");
      setAccountForm(EMPTY_ACCOUNT_FORM);
      setAccountDrawerMode("");
      await loadWorkspace(workspace.client.id);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function updateAccount(e) {
    e.preventDefault();
    if (!workspace?.client?.id || !selectedAccount?.id) return;
    setAccountBackendMessage("");
    const duplicate = (workspace.accounts || []).some((account) => (
      account.id !== selectedAccount.id &&
      String(account.code || "").trim().toLowerCase() === String(accountForm.code || "").trim().toLowerCase()
    ));
    if (duplicate) {
      toast.error("An account with this code already exists");
      return;
    }
    setBusy(true);
    try {
      await api.put(`/admin/accounting/clients/${workspace.client.id}/accounts/${selectedAccount.id}`, accountForm);
      toast.success("Account updated");
      setAccountDrawerMode("");
      setSelectedAccount(null);
      setAccountForm(EMPTY_ACCOUNT_FORM);
      await loadWorkspace(workspace.client.id);
    } catch (e) {
      const status = e?.response?.status || e?.status;
      if ([404, 405, 501].includes(status)) {
        setAccountBackendMessage("Backend endpoint required: update Chart of Accounts account.");
      } else {
        toast.error(formatApiError(e));
      }
    } finally {
      setBusy(false);
    }
  }

  function openAddAccountDrawer() {
    setSelectedAccount(null);
    setAccountBackendMessage("");
    setAccountForm(EMPTY_ACCOUNT_FORM);
    setAccountDrawerMode("add");
  }

  function openEditAccountDrawer(account) {
    setSelectedAccount(account);
    setAccountBackendMessage("");
    setAccountForm(accountToForm(account));
    setAccountDrawerMode("edit");
  }

  function openAccountHistoryDrawer() {
    setSelectedAccount(null);
    setAccountBackendMessage("");
    setAccountForm(EMPTY_ACCOUNT_FORM);
    setAccountDrawerMode("history");
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
          updateAccount={updateAccount}
          accountDrawerMode={accountDrawerMode}
          selectedAccount={selectedAccount}
          accountBackendMessage={accountBackendMessage}
          openAddAccountDrawer={openAddAccountDrawer}
          openAccountHistoryDrawer={openAccountHistoryDrawer}
          openEditAccountDrawer={openEditAccountDrawer}
          setAccountDrawerMode={setAccountDrawerMode}
          setSelectedAccount={setSelectedAccount}
          setAccountBackendMessage={setAccountBackendMessage}
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
    updateAccount,
    accountDrawerMode,
    selectedAccount,
    accountBackendMessage,
    openAddAccountDrawer,
    openAccountHistoryDrawer,
    openEditAccountDrawer,
    setAccountDrawerMode,
    setSelectedAccount,
    setAccountBackendMessage,
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
  const isBankingModule = module === "banking";
  const suppressGlobalFilterBar = isBankingModule || module === "payables" || module === "receivables";

  function renderTab() {
    if (module === "ai_workspace") {
      return <AIAccountingWorkspace workspace={workspace} activeTab={moduleTab} />;
    }

    if (module === "payables") {
      return <AccountsPayableWorkspace workspace={workspace} tab={moduleTab} setTab={setModuleTab} reloadWorkspace={reloadWorkspace} busy={busy} />;
    }

    if (module === "receivables") {
      return <AccountsReceivableWorkspace workspace={workspace} tab={moduleTab} setTab={setModuleTab} reloadWorkspace={reloadWorkspace} busy={busy} />;
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
        return (
          <ChartOfAccounts
            accounts={workspace.accounts}
            clientId={workspace.client.id}
            form={accountForm}
            setForm={setAccountForm}
            createAccount={createAccount}
            updateAccount={updateAccount}
            busy={busy}
            drawerMode={accountDrawerMode}
            selectedAccount={selectedAccount}
            backendMessage={accountBackendMessage}
            openAddAccount={openAddAccountDrawer}
            openEditAccount={openEditAccountDrawer}
            closeDrawer={() => {
              setAccountDrawerMode("");
              setSelectedAccount(null);
              setAccountForm(EMPTY_ACCOUNT_FORM);
              setAccountBackendMessage("");
            }}
          />
        );
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
          {!isBankingModule ? (
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
              {module === "coa" && moduleTab === "Chart of Accounts" ? (
                <>
                  <Button type="button" variant="outline" onClick={openAccountHistoryDrawer}>History</Button>
                  <Button type="button" className="gap-2" onClick={openAddAccountDrawer} style={{ background: "var(--brand)" }}>
                    <Plus className="h-4 w-4" /> Add account
                  </Button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>
      {!suppressGlobalFilterBar ? <AccountingFilterBar workspace={workspace} filters={filters} setFilters={setFilters} /> : null}
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
                      <p className="text-stone-500">{item.supplier_name || "Unknown supplier"} Â· {formatMoney(item.purchase_cost)} Â· confidence {item.confidence}%</p>
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

function apFormTotals(lines) {
  return (lines || []).reduce((total, line) => {
    const net = Number(line.net_amount || 0);
    const vat = Number(line.vat_amount || 0);
    const gross = Number(line.gross_amount || (net + vat) || 0);
    return { net: total.net + net, vat: total.vat + vat, gross: total.gross + gross };
  }, { net: 0, vat: 0, gross: 0 });
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

function ChartOfAccounts({ accounts, clientId, form, setForm, createAccount, updateAccount, busy, drawerMode, selectedAccount, backendMessage, openEditAccount, closeDrawer }) {
  const [filters, setFilters] = useState({ category: "", account_type: "", purpose: "", active: "active", search: "" });
  const [drawerTab, setDrawerTab] = useState("General");
  const [accountHistory, setAccountHistory] = useState([]);
  const [allHistory, setAllHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyMessage, setHistoryMessage] = useState("");
  const [historyFilters, setHistoryFilters] = useState({ search: "", action: "", user: "", date_from: "", date_to: "", status: "" });
  const accountRows = accounts || [];
  const isEditing = drawerMode === "edit";
  const isHistoryView = drawerMode === "history";
  const protectedAccount = isEditing && isProtectedAccount(selectedAccount);
  const bankCompatible = isBankCompatibleAccount(form);
  const duplicateCode = drawerMode === "add" && !!form.code && accountRows.some((account) => String(account.code || "").trim().toLowerCase() === form.code.trim().toLowerCase());

  const loadAccountHistory = useCallback(async () => {
    if (!clientId || !selectedAccount?.id) return;
    setHistoryLoading(true);
    setHistoryMessage("");
    try {
      const { data } = await api.get(`/admin/accounting/clients/${clientId}/accounts/${selectedAccount.id}/history`);
      setAccountHistory(Array.isArray(data?.history) ? data.history : []);
    } catch (e) {
      const status = e?.response?.status || e?.status;
      if ([404, 405, 501].includes(status)) {
        setHistoryMessage("Backend endpoint required: Chart of Accounts audit history.");
      } else {
        setHistoryMessage(formatApiError(e));
      }
      setAccountHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [clientId, selectedAccount?.id]);

  const loadAllHistory = useCallback(async () => {
    if (!clientId) return;
    setHistoryLoading(true);
    setHistoryMessage("");
    try {
      const { data } = await api.get(`/admin/accounting/clients/${clientId}/accounts/history`);
      setAllHistory(Array.isArray(data?.history) ? data.history : []);
    } catch (e) {
      const status = e?.response?.status || e?.status;
      if ([404, 405, 501].includes(status)) {
        setHistoryMessage("Backend endpoint required: Chart of Accounts audit history.");
      } else {
        setHistoryMessage(formatApiError(e));
      }
      setAllHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    setDrawerTab("General");
    setHistoryMessage("");
    setAccountHistory([]);
  }, [drawerMode, selectedAccount?.id]);

  useEffect(() => {
    if (drawerMode === "edit" && drawerTab === "History") {
      loadAccountHistory();
    }
    if (drawerMode === "history") {
      loadAllHistory();
    }
  }, [drawerMode, drawerTab, loadAccountHistory, loadAllHistory]);

  function setShowInBanking(checked) {
    if (!checked) {
      setForm((current) => ({ ...current, show_in_banking: false, banking_enabled: false }));
      return;
    }
    setForm((current) => ({
      ...current,
      category: "Asset",
      account_type: "Bank",
      purpose: "Bank Account",
      normal_balance: "debit",
      show_in_banking: true,
      banking_enabled: true,
    }));
  }

  const visibleAccounts = accountRows.filter((account) => {
    if (filters.category && account.category !== filters.category) return false;
    if (filters.account_type && account.account_type !== filters.account_type) return false;
    if (filters.purpose && account.purpose !== filters.purpose) return false;
    if (filters.active === "active" && account.active === false) return false;
    if (filters.active === "inactive" && account.active !== false) return false;
    const needle = filters.search.trim().toLowerCase();
    if (needle && !`${account.code || ""} ${account.name || ""} ${account.account_type || ""} ${account.purpose || ""}`.toLowerCase().includes(needle)) return false;
    return true;
  });

  return (
    <div className={drawerMode && drawerMode !== "edit" ? "grid gap-4 xl:grid-cols-[1fr_380px]" : "space-y-4"}>
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
          <div className="flex rounded-md border border-stone-200 bg-stone-50 p-1">
            {[["active", "Active"], ["inactive", "Inactive"], ["", "All"]].map(([value, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => setFilters((current) => ({ ...current, active: value }))}
                className={`flex-1 rounded px-2 py-1 text-xs font-semibold ${filters.active === value ? "bg-white text-emerald-800 shadow-sm" : "text-stone-600 hover:text-stone-900"}`}
              >
                {label}
              </button>
            ))}
          </div>
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
                <th className="px-3 py-2">Banking</th>
                <th className="px-3 py-2">Control</th>
                <th className="px-3 py-2">Active</th>
                <th className="px-3 py-2 text-right">Current Balance</th>
              </tr>
            </thead>
            <tbody>
              {visibleAccounts.map((account) => {
                const selected = drawerMode === "edit" && isSameAccount(account, selectedAccount);
                return (
                  <React.Fragment key={account.id || account.code}>
                    <tr
                      onClick={() => openEditAccount(account)}
                      className={`cursor-pointer border-t border-stone-100 hover:bg-emerald-50/40 ${selected ? "border-l-4 border-l-emerald-700 bg-emerald-50/80 shadow-[inset_0_0_0_1px_rgba(4,120,87,0.16)] hover:bg-emerald-50" : "border-l-4 border-l-transparent"}`}
                    >
                      <td className={`px-3 py-2 font-semibold text-stone-900 ${selected ? "font-bold" : ""}`}>{account.code}</td>
                      <td className={`px-3 py-2 ${selected ? "font-semibold text-stone-900" : ""}`}>{account.name}</td>
                      <td className="px-3 py-2 text-stone-600">{account.category}</td>
                      <td className="px-3 py-2 text-stone-600">{account.account_type || account.type}</td>
                      <td className="px-3 py-2 text-stone-600">{account.purpose || "Standard Nominal"}</td>
                      <td className="px-3 py-2">{account.show_in_banking || account.banking_enabled ? <Badge className="bg-emerald-100 text-emerald-800">Shown</Badge> : isBankCompatibleAccount(account) ? <Badge variant="outline">Not shown</Badge> : "-"}</td>
                      <td className="px-3 py-2">{isProtectedAccount(account) ? <Badge variant="outline">Control</Badge> : "-"}</td>
                      <td className="px-3 py-2">{account.active === false ? <Badge className="bg-stone-100 text-stone-700">Inactive</Badge> : <Badge className="bg-emerald-100 text-emerald-800">Active</Badge>}</td>
                      <td className="px-3 py-2 text-right font-semibold">{formatMoney(account.current_balance)}</td>
                    </tr>
                    {selected ? (
                      <tr className="border-t border-emerald-200 bg-emerald-50/30">
                        <td colSpan="9" className="p-3">
                          <AccountEditorContent
                            account={selectedAccount}
                            form={form}
                            setForm={setForm}
                            updateAccount={updateAccount}
                            busy={busy}
                            duplicateCode={duplicateCode}
                            protectedAccount={protectedAccount}
                            bankCompatible={bankCompatible}
                            backendMessage={backendMessage}
                            drawerTab={drawerTab}
                            setDrawerTab={setDrawerTab}
                            setShowInBanking={setShowInBanking}
                            accountHistory={accountHistory}
                            historyLoading={historyLoading}
                            historyMessage={historyMessage}
                            closeDrawer={closeDrawer}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
              {!visibleAccounts.length ? (
                <tr>
                  <td colSpan="9" className="px-3 py-10 text-center text-stone-500">No accounts match the current filters.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>
      {drawerMode && drawerMode !== "edit" ? (
        <div className="fixed inset-x-3 bottom-3 top-3 z-40 overflow-y-auto rounded-md bg-white shadow-2xl xl:sticky xl:inset-auto xl:top-4 xl:z-auto xl:max-h-[calc(100vh-2rem)] xl:self-start xl:shadow-none">
        <Panel title={isHistoryView ? "Chart of Accounts history" : isEditing ? "Edit account" : "Add account"}>
          {isHistoryView ? (
            <FullAccountHistoryPanel
              history={allHistory}
              loading={historyLoading}
              message={historyMessage}
              filters={historyFilters}
              setFilters={setHistoryFilters}
              closeDrawer={closeDrawer}
            />
          ) : (
            <div className="space-y-3">
              {isEditing ? <AccountDrawerContextHeader account={selectedAccount} /> : null}
              {isEditing ? (
                <div className="flex rounded-md border border-stone-200 bg-stone-50 p-1">
                  {["General", "History"].map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setDrawerTab(tab)}
                      className={`flex-1 rounded px-2 py-1 text-sm font-semibold ${drawerTab === tab ? "bg-white text-emerald-800 shadow-sm" : "text-stone-600 hover:text-stone-900"}`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
              ) : null}
              {drawerTab === "History" && isEditing ? (
                <AccountHistoryPanel account={selectedAccount} protectedAccount={protectedAccount} history={accountHistory} loading={historyLoading} message={historyMessage} closeDrawer={closeDrawer} />
              ) : (
                <form onSubmit={isEditing ? updateAccount : createAccount} className="space-y-3">
                  {protectedAccount ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      This is a system control account used by EPOS Native Accounting and cannot be structurally edited.
                    </div>
                  ) : null}
                  {backendMessage ? <InlineFormMessage message={backendMessage} /> : null}
                  {duplicateCode ? <InlineFormMessage message="An account with this code already exists." tone="error" /> : null}
                  <AccountDrawerField label="Account code" value={form.code} disabled={protectedAccount} onChange={(value) => setForm((current) => ({ ...current, code: value }))} />
                  <AccountDrawerField label="Account name" value={form.name} disabled={protectedAccount} onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
                  <AccountDrawerSelect label="Category" value={form.category} options={ACCOUNT_CATEGORIES} disabled={protectedAccount} onChange={(value) => setForm((current) => ({ ...current, category: value }))} />
                  <AccountDrawerSelect label="Account type" value={form.account_type} options={ACCOUNT_TYPES} disabled={protectedAccount} onChange={(value) => setForm((current) => ({ ...current, account_type: value }))} />
                  <AccountDrawerSelect label="Purpose" value={form.purpose} options={ACCOUNT_PURPOSES} disabled={protectedAccount} onChange={(value) => setForm((current) => ({ ...current, purpose: value }))} />
                  <AccountDrawerSelect label="Normal balance" value={form.normal_balance} options={[["debit", "Debit"], ["credit", "Credit"]]} disabled={protectedAccount} onChange={(value) => setForm((current) => ({ ...current, normal_balance: value }))} />
                  <label className={`flex items-center gap-2 rounded-md border border-stone-200 p-3 text-sm font-semibold ${protectedAccount ? "bg-stone-50 text-stone-500" : "text-stone-700"}`}>
                    <input type="checkbox" checked={!!form.is_control_account} disabled={protectedAccount} onChange={(e) => setForm((current) => ({ ...current, is_control_account: e.target.checked }))} />
                    Control account
                  </label>
                  <label className={`block rounded-md border border-stone-200 p-3 text-sm ${!bankCompatible || protectedAccount ? "bg-stone-50 text-stone-500" : "text-stone-700"}`}>
                    <span className="flex items-center gap-2 font-semibold">
                      <input type="checkbox" checked={!!(form.show_in_banking || form.banking_enabled)} disabled={!bankCompatible || protectedAccount} onChange={(e) => setShowInBanking(e.target.checked)} />
                      Show in Banking
                    </span>
                    <span className="mt-1 block text-xs font-normal text-stone-500">
                      {bankCompatible ? "Use this for actual bank, cash, card, Stripe, PayPal, or clearing accounts that need statement import and reconciliation." : "Only bank, cash, card, payment, or clearing accounts can appear in Banking."}
                    </span>
                  </label>
                  <label className="flex items-center gap-2 rounded-md border border-stone-200 p-3 text-sm font-semibold text-stone-700">
                    <input type="checkbox" checked={form.active !== false} disabled={protectedAccount && accountHasPostings(selectedAccount)} onChange={(e) => setForm((current) => ({ ...current, active: e.target.checked }))} />
                    Active
                  </label>
                  {protectedAccount && accountHasPostings(selectedAccount) ? <p className="text-xs text-stone-500">This account has postings or is required by a core module, so it cannot be deactivated here.</p> : null}
                  <AccountDrawerField label="Description" value={form.description} onChange={(value) => setForm((current) => ({ ...current, description: value }))} />
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" className="flex-1" onClick={closeDrawer}>Cancel</Button>
                    <Button disabled={busy || duplicateCode} className="flex-1 gap-2" style={{ background: "var(--brand)" }}>
                      <Plus className="h-4 w-4" /> {isEditing ? "Save account" : "Create account"}
                    </Button>
                  </div>
                  {isEditing && !protectedAccount ? (
                    <Button type="button" variant="outline" className="w-full" disabled={busy || form.active === false} onClick={() => setForm((current) => ({ ...current, active: false }))}>Make inactive</Button>
                  ) : null}
                </form>
              )}
            </div>
          )}
        </Panel>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-stone-300 bg-stone-50 p-4 text-sm text-stone-600">
          Select an account to edit it, or use Add account from the page header to create a custom nominal account.
        </div>
      )}
    </div>
  );
}

function AccountEditorContent({ account, form, setForm, updateAccount, busy, duplicateCode, protectedAccount, bankCompatible, backendMessage, drawerTab, setDrawerTab, setShowInBanking, accountHistory, historyLoading, historyMessage, closeDrawer }) {
  return (
    <div className="rounded-md border border-emerald-200 bg-white p-3 shadow-sm">
      <div className="grid gap-4 xl:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <AccountDrawerContextHeader account={account} />
          <div className="flex rounded-md border border-stone-200 bg-stone-50 p-1">
            {["General", "History"].map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setDrawerTab(tab)}
                className={`flex-1 rounded px-2 py-1 text-sm font-semibold ${drawerTab === tab ? "bg-white text-emerald-800 shadow-sm" : "text-stone-600 hover:text-stone-900"}`}
              >
                {tab}
              </button>
            ))}
          </div>
          {protectedAccount ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              This is a system control account used by EPOS Native Accounting and cannot be structurally edited.
            </div>
          ) : null}
        </div>
        {drawerTab === "History" ? (
          <AccountHistoryPanel account={account} protectedAccount={protectedAccount} history={accountHistory} loading={historyLoading} message={historyMessage} closeDrawer={closeDrawer} />
        ) : (
          <form onSubmit={updateAccount} className="space-y-3">
            {backendMessage ? <InlineFormMessage message={backendMessage} /> : null}
            {duplicateCode ? <InlineFormMessage message="An account with this code already exists." tone="error" /> : null}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <AccountDrawerField label="Account code" value={form.code} disabled={protectedAccount} onChange={(value) => setForm((current) => ({ ...current, code: value }))} />
              <AccountDrawerField label="Account name" value={form.name} disabled={protectedAccount} onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
              <AccountDrawerSelect label="Category" value={form.category} options={ACCOUNT_CATEGORIES} disabled={protectedAccount} onChange={(value) => setForm((current) => ({ ...current, category: value }))} />
              <AccountDrawerSelect label="Account type" value={form.account_type} options={ACCOUNT_TYPES} disabled={protectedAccount} onChange={(value) => setForm((current) => ({ ...current, account_type: value }))} />
              <AccountDrawerSelect label="Purpose" value={form.purpose} options={ACCOUNT_PURPOSES} disabled={protectedAccount} onChange={(value) => setForm((current) => ({ ...current, purpose: value }))} />
              <AccountDrawerSelect label="Normal balance" value={form.normal_balance} options={[["debit", "Debit"], ["credit", "Credit"]]} disabled={protectedAccount} onChange={(value) => setForm((current) => ({ ...current, normal_balance: value }))} />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <label className={`flex items-center gap-2 rounded-md border border-stone-200 p-3 text-sm font-semibold ${protectedAccount ? "bg-stone-50 text-stone-500" : "text-stone-700"}`}>
                <input type="checkbox" checked={!!form.is_control_account} disabled={protectedAccount} onChange={(e) => setForm((current) => ({ ...current, is_control_account: e.target.checked }))} />
                Control account
              </label>
              <label className={`block rounded-md border border-stone-200 p-3 text-sm ${!bankCompatible || protectedAccount ? "bg-stone-50 text-stone-500" : "text-stone-700"}`}>
                <span className="flex items-center gap-2 font-semibold">
                  <input type="checkbox" checked={!!(form.show_in_banking || form.banking_enabled)} disabled={!bankCompatible || protectedAccount} onChange={(e) => setShowInBanking(e.target.checked)} />
                  Show in Banking
                </span>
                <span className="mt-1 block text-xs font-normal text-stone-500">
                  {bankCompatible ? "Use this for bank, cash, card, Stripe, PayPal, or clearing accounts." : "Only bank, cash, card, payment, or clearing accounts can appear in Banking."}
                </span>
              </label>
              <label className="flex items-center gap-2 rounded-md border border-stone-200 p-3 text-sm font-semibold text-stone-700">
                <input type="checkbox" checked={form.active !== false} disabled={protectedAccount && accountHasPostings(account)} onChange={(e) => setForm((current) => ({ ...current, active: e.target.checked }))} />
                Active
              </label>
            </div>
            {protectedAccount && accountHasPostings(account) ? <p className="text-xs text-stone-500">This account has postings or is required by a core module, so it cannot be deactivated here.</p> : null}
            <AccountDrawerField label="Description" value={form.description} onChange={(value) => setForm((current) => ({ ...current, description: value }))} />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={closeDrawer}>Cancel</Button>
              <Button disabled={busy || duplicateCode} className="gap-2" style={{ background: "var(--brand)" }}>
                <Plus className="h-4 w-4" /> Save account
              </Button>
              {!protectedAccount ? (
                <Button type="button" variant="outline" disabled={busy || form.active === false} onClick={() => setForm((current) => ({ ...current, active: false }))}>Make inactive</Button>
              ) : null}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function AccountDrawerContextHeader({ account, sticky = false }) {
  const shell = sticky ? "sticky top-0 z-10 -mx-3 -mt-3 border-b border-stone-100 bg-white px-3 py-3" : "rounded-md border border-stone-200 bg-stone-50 px-3 py-3";
  return (
    <div className={shell}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-stone-900">{account?.code || "-"} - {account?.name || "Account"}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {account?.active === false ? <Badge className="bg-stone-100 text-stone-700">Inactive</Badge> : <Badge className="bg-emerald-100 text-emerald-800">Active</Badge>}
            {isProtectedAccount(account) ? <Badge variant="outline">Control</Badge> : null}
            {account?.show_in_banking || account?.banking_enabled ? <Badge className="bg-emerald-100 text-emerald-800">Banking</Badge> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function AccountHistoryPanel({ account, protectedAccount, history, loading, message, closeDrawer }) {
  return (
    <div className="space-y-3">
      {protectedAccount ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This is a system control account. Structural changes are restricted, but history is retained.
        </div>
      ) : null}
      <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2">
        <div className="text-sm font-semibold text-stone-900">{account?.code || "-"} - {account?.name || "Account"}</div>
        <div className="text-xs text-stone-500">Nominal account audit timeline</div>
      </div>
      <HistoryTimeline history={history} loading={loading} message={message} />
      <Button type="button" variant="outline" className="w-full" onClick={closeDrawer}>Close</Button>
    </div>
  );
}

function FullAccountHistoryPanel({ history, loading, message, filters, setFilters, closeDrawer }) {
  const actions = Array.from(new Set(history.map((item) => item.action).filter(Boolean)));
  const users = Array.from(new Set(history.map((item) => item.user_name || item.user).filter(Boolean)));
  const filteredHistory = history.filter((item) => {
    const needle = filters.search.trim().toLowerCase();
    const haystack = `${item.account_code || ""} ${item.account_name || ""} ${item.field || ""} ${item.action || ""}`.toLowerCase();
    if (needle && !haystack.includes(needle)) return false;
    if (filters.action && item.action !== filters.action) return false;
    if (filters.user && (item.user_name || item.user) !== filters.user) return false;
    if (filters.date_from && String(item.created_at || "") < filters.date_from) return false;
    if (filters.date_to && String(item.created_at || "") > `${filters.date_to}T23:59:59`) return false;
    if (filters.status && String(item.account_status || item.status || "").toLowerCase() !== filters.status) return false;
    return true;
  });

  return (
    <div className="space-y-3">
      <div className="grid gap-2">
        <Input value={filters.search} onChange={(e) => setFilters((current) => ({ ...current, search: e.target.value }))} placeholder="Search code, name, field or action" className="h-9" />
        <select value={filters.action} onChange={(e) => setFilters((current) => ({ ...current, action: e.target.value }))} className="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm">
          <option value="">All actions</option>
          {actions.map((action) => <option key={action} value={action}>{displayHistoryAction(action)}</option>)}
        </select>
        <select value={filters.user} onChange={(e) => setFilters((current) => ({ ...current, user: e.target.value }))} className="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm">
          <option value="">All users</option>
          {users.map((user) => <option key={user} value={user}>{user}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Date from" type="date" value={filters.date_from} onChange={(value) => setFilters((current) => ({ ...current, date_from: value }))} />
          <Field label="Date to" type="date" value={filters.date_to} onChange={(value) => setFilters((current) => ({ ...current, date_to: value }))} />
        </div>
        <select value={filters.status} onChange={(e) => setFilters((current) => ({ ...current, status: e.target.value }))} className="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm">
          <option value="">All account statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={() => downloadReportCsv("chart-of-accounts-history.csv", filteredHistory)}>
          <Download className="mr-2 h-4 w-4" /> Export
        </Button>
        <Button type="button" variant="outline" className="flex-1" onClick={closeDrawer}>Close</Button>
      </div>
      <HistoryTimeline history={filteredHistory} loading={loading} message={message} showAccount />
    </div>
  );
}

function HistoryTimeline({ history, loading, message, showAccount = false }) {
  if (loading) return <div className="rounded-md border border-stone-200 bg-stone-50 p-6 text-center text-sm text-stone-500">Loading history...</div>;
  if (message) return <InlineFormMessage message={message} />;
  if (!history.length) return <div className="rounded-md border border-dashed border-stone-300 bg-stone-50 p-6 text-center text-sm text-stone-600">No Chart of Accounts history found.</div>;
  return (
    <div className="space-y-2">
      {history.map((item) => (
        <div key={item.id || `${item.account_id}-${item.created_at}-${item.field}`} className="rounded-md border border-stone-200 bg-white p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-stone-900">{displayHistoryAction(item.action)}</div>
              {showAccount ? <div className="text-xs text-stone-500">{item.account_code || "-"} - {item.account_name || "Account"}</div> : null}
            </div>
            <div className="text-right text-xs text-stone-500">{formatDateTime(item.created_at)}</div>
          </div>
          <div className="mt-2 grid gap-1 text-xs text-stone-600">
            <div className="flex justify-between gap-3"><span>User</span><span className="text-right font-medium text-stone-800">{item.user_name || item.user || "-"}</span></div>
            <div className="flex justify-between gap-3"><span>Field changed</span><span className="text-right font-medium text-stone-800">{displayHistoryField(item.field)}</span></div>
            <div className="flex justify-between gap-3"><span>Previous value</span><span className="text-right font-medium text-stone-800">{displayHistoryValue(item.old_value)}</span></div>
            <div className="flex justify-between gap-3"><span>New value</span><span className="text-right font-medium text-stone-800">{displayHistoryValue(item.new_value)}</span></div>
            {item.note ? <div className="rounded bg-stone-50 px-2 py-1 text-stone-600">{item.note}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function displayHistoryAction(action) {
  return String(action || "Account updated").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayHistoryField(field) {
  return field ? String(field).replace(/_/g, " ") : "-";
}

function displayHistoryValue(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function isSameAccount(account, selectedAccount) {
  if (!account || !selectedAccount) return false;
  if (account.id && selectedAccount.id) return account.id === selectedAccount.id;
  return String(account.code || "").trim() === String(selectedAccount.code || "").trim();
}

function isBankCompatibleAccount(account) {
  const text = `${account?.purpose || ""} ${account?.account_type || account?.type || ""} ${account?.detail_type || ""} ${account?.name || ""}`.toLowerCase();
  return account?.purpose === "Bank Account" || text.includes("bank") || text.includes("cash") || text.includes("card") || text.includes("stripe") || text.includes("paypal") || text.includes("clearing") || text.includes("current asset") || text.includes("payment");
}

function isProtectedAccount(account) {
  if (!account) return false;
  const text = `${account.code || ""} ${account.name || ""} ${account.category || ""} ${account.account_type || account.type || ""} ${account.purpose || ""} ${account.detail_type || ""}`.toLowerCase();
  if (account.is_control_account || account.control_account || account.control || account.protected || account.system_account) return true;
  return ["trade debtors", "accounts receivable", "trade creditors", "accounts payable", "vat control", "bank control", "payroll control", "corporation tax", "retained earnings", "sales ledger", "purchase ledger"].some((term) => text.includes(term));
}

function accountHasPostings(account) {
  return Number(account?.current_balance || 0) !== 0 || Number(account?.posted_transactions || account?.transaction_count || account?.postings_count || 0) > 0 || !!account?.module_required;
}

function accountToForm(account = {}) {
  return {
    ...EMPTY_ACCOUNT_FORM,
    ...account,
    id: account.id || "",
    code: account.code || "",
    name: account.name || "",
    category: account.category || "Expense",
    account_type: account.account_type || account.type || "Overheads",
    purpose: account.purpose || account.detail_type || "Standard Nominal",
    normal_balance: account.normal_balance || "debit",
    is_control_account: !!(account.is_control_account || account.control_account || account.control || account.protected || account.system_account),
    show_in_banking: !!(account.show_in_banking || account.banking_enabled),
    banking_enabled: !!(account.show_in_banking || account.banking_enabled),
    active: account.active !== false,
    description: account.description || "",
  };
}

function AccountDrawerField({ label, value, onChange, disabled = false }) {
  return (
    <div>
      <Label className="text-xs font-semibold text-stone-600">{label}</Label>
      <Input value={value || ""} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="mt-1 h-9" />
    </div>
  );
}

function AccountDrawerSelect({ label, value, onChange, options = [], disabled = false }) {
  const optionRows = options.map((option) => Array.isArray(option) ? { value: option[0], label: option[1] } : { value: option, label: option });
  return (
    <div>
      <Label className="text-xs font-semibold text-stone-600">{label}</Label>
      <select value={value || ""} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm disabled:bg-stone-50 disabled:text-stone-500">
        {optionRows.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  );
}

function InlineFormMessage({ message, tone = "info" }) {
  const className = tone === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-800";
  return <div className={`rounded-md border px-3 py-2 text-sm ${className}`}>{message}</div>;
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
