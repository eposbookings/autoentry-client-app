import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api, formatApiError } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import OfficialFormPreview from "@/components/official-forms/OfficialFormPreview";
import OfficialFormDetails from "@/components/official-forms/OfficialFormDetails";
import {
  ArrowRight,
  Activity,
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  CircleHelp,
  ClipboardCheck,
  Gauge,
  MessageSquare,
  ListChecks,
  Plus,
  RefreshCw,
  Sparkles,
  Printer,
  Download,
  Upload,
  UsersRound,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  ACCOUNT_CATEGORIES,
  ACCOUNT_PURPOSES,
  ACCOUNT_TYPES,
  COA_CASH_FLOW_CATEGORIES,
  COA_CIS_ROLES,
  COA_FILING_STATUSES,
  COA_MODULES,
  COA_STATEMENTS,
  MODULES,
  MODULE_DETAILS,
} from "./moduleConfig";
import BankingWorkspace from "./BankingWorkspace";
import AccountsPayableWorkspace from "./AccountsPayableWorkspace";
import AccountsReceivableWorkspace from "./AccountsReceivableWorkspace";
import {
  AccountCodeSelect,
  ContactCount,
  DEFAULT_PAGE_SIZE,
  Field,
  Info,
  Panel,
  PaginationFooter,
  ReportRows,
  SelectField,
  SummaryCard,
  calculateVatInclusiveAmounts,
  displayAuditValue,
  downloadReportCsv,
  formatDate,
  formatDateTime,
  formatMoney,
  normalisePaginatedResponse,
} from "./shared";
import {
  cachedAccountingWorkspace,
  fetchAccountingWorkspace,
} from "./accountingWorkspaceCache";

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
  master_account_id: "",
  module: "CORE",
  default_active: "Active",
  account_class: "Expense",
  account_subtype: "Overheads",
  statement: "P&L",
  control_account_type: "None",
  allow_manual_posting: true,
  system_account: false,
  reporting_category_id: "",
  internal_reporting_category: "",
  statutory_presentation: "",
  cash_flow_category: "",
  default_tax_treatment: "",
  vat_behaviour: "",
  cis_role: "",
  requires_dimension: "",
  current_noncurrent_rule: "",
  filing_status: "Ready",
  suggested_taxonomy_concept: "",
  implementation_note: "",
  opening_balance: "",
  original_opening_balance: "",
  bank_account_id: "",
  bank_name: "",
  account_number: "",
  sort_code: "",
  currency: "GBP",
  allow_payments: true,
  allow_receipts: true,
};

function resolveAccountingRouteTab(moduleKey, requestedTab) {
  if (!moduleKey || !MODULE_DETAILS[moduleKey]) return "";
  if (moduleKey === "vat" && ["Dashboard", "VAT Periods"].includes(requestedTab)) return "VAT Returns";
  if (moduleKey === "vat" && requestedTab === "Reports") return "VAT Transactions";
  if (moduleKey === "reports" && ["Dashboard", "Financial Statements"].includes(requestedTab)) return "Profit and Loss";
  return requestedTab && MODULE_DETAILS[moduleKey].tabs?.includes(requestedTab)
    ? requestedTab
    : MODULE_DETAILS[moduleKey].tabs?.[0] || "";
}

export default function AdminAccountancySoftware() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canManageClients = (user?.permissions || []).includes("clients.manage");
  const initialRoute = useMemo(() => new URLSearchParams(window.location.search), []);
  const initialClientId = initialRoute.get("client_id") || null;
  const requestedModule = initialRoute.get("module");
  const initialModule = requestedModule && MODULE_DETAILS[requestedModule] ? requestedModule : null;
  const initialModuleTab = resolveAccountingRouteTab(initialModule, initialRoute.get("tab"));
  const initialWorkspace = cachedAccountingWorkspace(initialClientId);
  const [clients, setClients] = useState([]);
  const [selectedId, setSelectedId] = useState(initialClientId);
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [module, setModule] = useState(initialModule);
  const [moduleTab, setModuleTab] = useState(initialModuleTab);
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
  const [settingsForm, setSettingsForm] = useState(initialWorkspace?.accounting_settings || {});

  const loadClients = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/accounting/clients");
      const nextClients = Array.isArray(data?.clients) ? data.clients : [];
      setClients(nextClients);
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }, []);

  const loadWorkspace = useCallback(async (clientId, { force = true } = {}) => {
    if (!clientId) {
      setWorkspace(null);
      return;
    }
    const cached = !force ? cachedAccountingWorkspace(clientId) : null;
    if (cached) {
      setWorkspace(cached);
      setSettingsForm(cached?.accounting_settings || {});
      return;
    }
    setBusy(true);
    try {
      const data = await fetchAccountingWorkspace(clientId, { force });
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
  useEffect(() => { loadWorkspace(selectedId, { force: false }); }, [selectedId, loadWorkspace]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (selectedId) params.set("client_id", selectedId);
    else params.delete("client_id");
    if (selectedId && module) params.set("module", module);
    else params.delete("module");
    if (selectedId && module && moduleTab) params.set("tab", moduleTab);
    else params.delete("tab");
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash || ""}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, [module, moduleTab, selectedId]);

  const filteredClients = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return clients;
    return clients.filter((client) => (
      `${client.business_name || ""} ${client.email || ""} ${client.first_name || ""} ${client.last_name || ""}`.toLowerCase().includes(needle)
    ));
  }, [clients, q]);

  function openClient(client) {
    const clientId = typeof client === "string" ? client : client?.id;
    if (!clientId) return;
    if (typeof client === "object" && !client.native_accounting_enabled && !["native", "epos_native"].includes(client.accounting_destination)) {
      if (!canManageClients) {
        toast.error("You do not have permission to open client settings.");
        return;
      }
      navigate(`/admin/clients/${clientId}`);
      return;
    }
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
      await api.put(`/admin/accounting/clients/${workspace.client.id}/accounts/${selectedAccount.id}`, accountUpdatePayload(accountForm));
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

  async function deleteAccount(account) {
    if (!workspace?.client?.id || !account?.id || !account.can_delete) return;
    if (!window.confirm(`Permanently delete inactive nominal ${account.code} - ${account.name}?`)) return;
    setBusy(true);
    try {
      await api.delete(`/admin/accounting/clients/${workspace.client.id}/accounts/${account.id}`);
      toast.success("Inactive nominal deleted");
      setAccountDrawerMode("");
      setSelectedAccount(null);
      setAccountForm(EMPTY_ACCOUNT_FORM);
      await loadWorkspace(workspace.client.id);
    } catch (e) {
      toast.error(formatApiError(e));
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
          createClient={canManageClients ? () => navigate("/admin?create=1") : null}
          busy={busy}
        />
      )}

      {selectedId && !workspace && <EmptyWorkspace busy={busy} />}

      {workspace && !module && (
        <ClientAccountingHome
          workspace={workspace}
          openModule={openModule}
          backToClients={backToClients}
          openClientSettings={canManageClients ? () => navigate(`/admin/clients/${workspace.client.id}`) : null}
          openDeadlines={canManageClients ? () => navigate(`/admin/clients/${workspace.client.id}?section=deadlines`) : null}
          openOutstandingItems={canManageClients ? () => navigate(`/admin/clients/${workspace.client.id}?section=items`) : null}
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
          deleteAccount={deleteAccount}
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

function AccountingClientCards({ clients, q, setQ, openClient, refresh, createClient, busy }) {
  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 rounded-md border border-stone-200 bg-white p-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-stone-900">Clients</h1>
          <p className="mt-1 text-sm text-stone-600">Choose a client to open their EPOS Native Accounting workspace.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={refresh} disabled={busy} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
          {createClient && (
            <Button onClick={createClient} className="gap-2">
              <Plus className="h-4 w-4" /> New client
            </Button>
          )}
        </div>
      </header>

      <section className="rounded-md border border-stone-200 bg-white p-4">
        <div className="mb-4 max-w-xl">
          <Label className="text-xs font-semibold uppercase tracking-wide text-stone-500">Search clients</Label>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by business, contact or email" className="mt-2 h-10" />
        </div>

        {clients.length === 0 ? (
          <div className="rounded-md border border-dashed border-stone-200 bg-stone-50 p-8 text-center">
            <Building2 className="mx-auto h-9 w-9 text-stone-300" />
            <h2 className="mt-3 font-display text-lg font-semibold text-stone-900">No clients yet</h2>
            <p className="mt-1 text-sm text-stone-500">Create the first practice client to begin.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {clients.map((client) => (
              <button
                key={client.id}
                type="button"
                onClick={() => openClient(client)}
                className="group flex min-h-[210px] flex-col rounded-xl border border-stone-200 bg-white p-4 text-left shadow-[0_3px_12px_rgba(28,25,23,0.07)] transition duration-150 hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-[0_10px_26px_rgba(6,78,59,0.13)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="flex min-w-0 items-start gap-3">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                      <Building2 className="h-6 w-6" />
                    </span>
                    <span className="min-w-0 pt-0.5">
                      <span className="block truncate font-display text-base font-bold text-stone-950">{client.business_name}</span>
                      <span className="mt-1 block truncate text-xs text-stone-500">{client.email}</span>
                      <span className="mt-1.5 block text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                        {client.native_accounting_enabled || ["native", "epos_native"].includes(client.accounting_destination) ? "Native accounting client" : "External accounting client"}
                      </span>
                    </span>
                  </span>
                  <ArrowRight className="mt-3 h-4 w-4 shrink-0 text-stone-400 transition group-hover:translate-x-1 group-hover:text-emerald-700" />
                </span>
                <span className="mt-auto flex items-center gap-3 border-t border-stone-200 pt-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><CheckCircle2 className="h-4 w-4" /></span>
                  <span>
                    <span className="block text-[10px] font-semibold uppercase tracking-wide text-stone-500">Accounting status</span>
                    <span className="font-display text-sm font-bold text-emerald-800">
                      {client.native_accounting_enabled || ["native", "epos_native"].includes(client.accounting_destination)
                        ? "Open accounting software"
                        : "Open client settings"}
                    </span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ClientAccountingHome({ workspace, openModule, backToClients, openClientSettings, openDeadlines, openOutstandingItems, busy }) {
  return (
    <div className="space-y-3">
      <header className="flex flex-col gap-3 rounded-md border border-stone-200 bg-white p-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <Button variant="outline" onClick={backToClients} className="mb-3 gap-2">
            <ArrowRight className="h-4 w-4 rotate-180" /> Back to clients
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate font-display text-2xl font-bold text-stone-900">{workspace.client.business_name}</h1>
            <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Native EPOS Accounting</Badge>
          </div>
          <p className="mt-1 text-sm text-stone-500">
            {workspace.client.first_name} {workspace.client.last_name} - {workspace.client.email}
          </p>
        </div>
        {openClientSettings && (
          <Button variant="outline" onClick={openClientSettings} disabled={busy} className="gap-2">
            <UsersRound className="h-4 w-4" /> Client settings
          </Button>
        )}
      </header>

      <section className="rounded-lg border border-stone-200 bg-stone-50/40 p-4">
        <div className="mb-4">
          <h2 className="font-display text-xl font-bold text-stone-900">Accounting Software</h2>
          <p className="mt-1 text-sm text-stone-600">Choose the module you want to work in.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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

      {(openDeadlines || openOutstandingItems) && (
        <section className="rounded-lg border border-stone-200 bg-stone-50/40 p-4">
          <div className="mb-4">
            <h2 className="font-display text-xl font-bold text-stone-900">Client workflow</h2>
            <p className="mt-1 text-sm text-stone-600">Open the client’s deadlines and outstanding document work.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {openDeadlines && (
              <ClientWorkflowCard
                title="Deadlines"
                description="Review statutory dates, recurring service deadlines and completed tasks."
                action="Open deadlines"
                icon={CalendarClock}
                onOpen={openDeadlines}
              />
            )}
            {openOutstandingItems && (
              <ClientWorkflowCard
                title="Outstanding Items"
                description="Manage purchase and sales document requests and upload supporting lists."
                action="Open outstanding items"
                icon={ListChecks}
                onOpen={openOutstandingItems}
              />
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function ClientWorkflowCard({ title, description, action, icon: Icon, onOpen }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex min-h-[150px] items-start gap-4 rounded-xl border border-stone-200 bg-white p-5 text-left shadow-[0_3px_12px_rgba(28,25,23,0.07)] transition duration-150 hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-[0_10px_26px_rgba(6,78,59,0.13)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
        <Icon className="h-6 w-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-3">
          <span className="font-display text-lg font-bold text-stone-950">{title}</span>
          <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-stone-500 transition group-hover:translate-x-1 group-hover:text-emerald-800" />
        </span>
        <span className="mt-2 block text-sm leading-5 text-stone-600">{description}</span>
        <span className="mt-4 block text-xs font-bold uppercase tracking-wide text-emerald-700">{action}</span>
      </span>
    </button>
  );
}

function AccountingModuleCard({ moduleKey, icon: Icon, workspace, onOpen }) {
  const detail = MODULE_DETAILS[moduleKey];
  const statValue = detail?.stat ? detail.stat(workspace) : "-";
  const healthScore = moduleKey === "ai_workspace"
    ? Math.max(0, Math.min(100, Number.parseFloat(statValue) || 0))
    : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative flex min-h-[220px] flex-col overflow-hidden rounded-xl border border-stone-200 bg-white p-4 text-left shadow-[0_3px_12px_rgba(28,25,23,0.07)] transition duration-150 hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-[0_10px_26px_rgba(6,78,59,0.13)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
    >
      <span className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 items-start gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
            <Icon className="h-6 w-6" />
          </span>
          <span className="min-w-0 pt-1">
            <span className="block truncate font-display text-base font-bold leading-tight text-stone-950">{detail.title}</span>
            <span className="mt-1.5 block text-[11px] font-bold uppercase tracking-wide text-emerald-700">Manage</span>
          </span>
        </span>
        <ArrowRight className="mt-3 h-4 w-4 shrink-0 text-stone-500 transition group-hover:translate-x-1 group-hover:text-emerald-800" />
      </span>

      <span className="mt-4 grid flex-1 grid-cols-2 content-start gap-x-4 gap-y-1.5 text-xs leading-4 text-stone-600">
        {detail.manage.map((item) => (
          <span key={item} className="flex min-w-0 items-start gap-1.5">
            <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-stone-400" />
            <span className="truncate">{item}</span>
          </span>
        ))}
      </span>

      <span className="mt-4 flex items-center gap-3 border-t border-stone-200 pt-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-stone-500">{detail.statLabel}</span>
          <span className="mt-0.5 block truncate font-display text-base font-bold text-emerald-800">{statValue}</span>
        </span>
        {healthScore !== null ? (
          <span className="h-1.5 w-24 overflow-hidden rounded-full bg-stone-200">
            <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${healthScore}%` }} />
          </span>
        ) : null}
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
    deleteAccount,
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
  const [filters, setFilters] = useState({
    report_period: "custom",
    date_from: "",
    date_to: "",
    financial_year_id: "",
    period_id: "",
    search: "",
    location_id: "",
    dimension_id: "",
    group_by: "",
  });
  const [recordHeaderContext, setRecordHeaderContext] = useState(null);
  const [recordActionMenuOpen, setRecordActionMenuOpen] = useState(false);
  const detail = MODULE_DETAILS[module];
  const isBankingModule = module === "banking";
  const showWorkspaceSearch = module === "gl"
    || (module === "fixed_assets" && ["Asset Register", "Asset Categories", "Depreciation"].includes(moduleTab));

  useEffect(() => {
    setRecordHeaderContext(null);
    setRecordActionMenuOpen(false);
  }, [module, moduleTab]);

  useEffect(() => {
    setRecordActionMenuOpen(false);
  }, [recordHeaderContext?.activeTab, recordHeaderContext?.title]);

  function renderTab() {
    if (module === "ai_workspace") {
      return <AIAccountingWorkspace workspace={workspace} activeTab={moduleTab} />;
    }

    if (module === "payables") {
      return <AccountsPayableWorkspace workspace={workspace} tab={moduleTab} setTab={setModuleTab} reloadWorkspace={reloadWorkspace} busy={busy} setHeaderContext={setRecordHeaderContext} />;
    }

    if (module === "receivables") {
      return <AccountsReceivableWorkspace workspace={workspace} tab={moduleTab} setTab={setModuleTab} reloadWorkspace={reloadWorkspace} busy={busy} setHeaderContext={setRecordHeaderContext} />;
    }

    if (module === "banking") {
      return <BankingWorkspace workspace={workspace} tab={moduleTab} reloadWorkspace={reloadWorkspace} busy={busy} setHeaderContext={setRecordHeaderContext} />;
    }

    if (module === "vat") {
      return <LazyModuleWorkspace workspace={workspace} endpoint="vat/workspace" field="vat_engine">{(loaded) => <VatEngineWorkspace workspace={loaded} tab={moduleTab} filters={filters} reloadWorkspace={reloadWorkspace} busy={busy} />}</LazyModuleWorkspace>;
    }

    if (module === "fixed_assets") {
      return <LazyModuleWorkspace workspace={workspace} endpoint="fixed-assets/workspace" field="fixed_assets">{(loaded) => <FixedAssetsWorkspace workspace={loaded} tab={moduleTab} search={filters.search} reloadWorkspace={reloadWorkspace} busy={busy} />}</LazyModuleWorkspace>;
    }

    if (module === "year_end") {
      return <LazyModuleWorkspace workspace={workspace} endpoint="year-end/workspace" field="year_end">{(loaded) => <YearEndWorkspace workspace={loaded} tab={moduleTab} reloadWorkspace={reloadWorkspace} busy={busy} />}</LazyModuleWorkspace>;
    }

    if (module === "year_end_accounts") {
      return <LazyModuleWorkspace workspace={workspace} endpoint="year-end-accounts/workspace" field="year_end_accounts">{(loaded) => <YearEndAccountsWorkspace workspace={loaded} tab={moduleTab} />}</LazyModuleWorkspace>;
    }

    if (module === "gl") {
      return <LazyGeneralLedger workspace={workspace} moduleTab={moduleTab} filters={filters} detail={detail} setHeaderContext={setRecordHeaderContext} />;
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
            deleteAccount={deleteAccount}
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

    if (module === "audit") return <AuditTrailWorkspace clientId={workspace.client?.id} />;

    if (module === "reports") return <LazyReportsWorkspace workspace={workspace} activeReport={moduleTab} filters={filters} setFilters={setFilters} />;

    if (module === "settings") {
      if (moduleTab === "Accounting Settings") {
        return <AccountingSettingsWorkspace accounts={workspace.accounts} form={settingsForm} setForm={setSettingsForm} saveSettings={saveAccountingSettings} busy={busy} />;
      }
      if (moduleTab === "Locations") {
        return <LocationsSettingsWorkspace clientId={workspace.client?.id} />;
      }
      if (moduleTab === "Dimensions") {
        return <DimensionsSettingsWorkspace clientId={workspace.client?.id} />;
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
        <div className="mb-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={backToClientHome} className="gap-2">
              <ArrowRight className="h-4 w-4 rotate-180" /> {workspace.client.business_name}
            </Button>
            {recordHeaderContext?.backLabel ? (
              <Button type="button" variant="outline" onClick={recordHeaderContext.onBack} className="gap-2">
                <ArrowRight className="h-4 w-4 rotate-180" /> {recordHeaderContext.backLabel}
              </Button>
            ) : null}
          </div>
          {recordHeaderContext?.variant === "banking" && recordHeaderContext?.tabs?.length ? (
            <div className="flex flex-wrap gap-2">
              {recordHeaderContext.tabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => recordHeaderContext.onTabChange?.(tab)}
                  className={`rounded-md px-3 py-2 text-sm font-semibold ${recordHeaderContext.activeTab === tab ? "bg-[var(--brand)] text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"}`}
                >
                  {tab}
                </button>
              ))}
            </div>
          ) : !isBankingModule ? (
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
              {!recordHeaderContext && module === "coa" && moduleTab === "Chart of Accounts" ? (
                <>
                  <Button type="button" className="gap-2" onClick={openAddAccountDrawer} style={{ background: "var(--brand)" }}>
                    <Plus className="h-4 w-4" /> Add account
                  </Button>
                </>
              ) : null}
            </div>
          ) : recordHeaderContext?.actions?.length ? (
            <div className="flex flex-wrap gap-2">
              {recordHeaderContext.actions.map((action) => (
                <Button key={action.label} type="button" variant="outline" className="gap-2" onClick={action.onClick}>
                  {action.icon === false ? null : <Plus className="h-4 w-4" />} {action.label}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">Accounting Software</p>
              <h1 className="mt-1 font-display text-2xl font-bold text-stone-900">{detail.title}</h1>
              <p className="mt-1 text-sm text-stone-500">{workspace.client.business_name}</p>
            </div>
            {recordHeaderContext?.title ? (
              <div className="border-l border-stone-200 pl-4">
                <div className="flex flex-wrap items-center gap-2">
                  {recordHeaderContext.titlePrefix ? <span className="text-xl" aria-hidden="true">{recordHeaderContext.titlePrefix}</span> : null}
                  <h2 className="font-display text-xl font-semibold text-stone-900">{recordHeaderContext.title}</h2>
                  {recordHeaderContext.badges?.map((badge) => (
                    <Badge key={badge.label} className={badge.className}>{badge.label}</Badge>
                  ))}
                </div>
                <p className="mt-1 text-sm text-stone-500">{recordHeaderContext.subtitle}</p>
              </div>
            ) : null}
            {recordHeaderContext?.actionsLeft && recordHeaderContext?.actionMenu?.length ? (
              <div className="relative">
                <Button type="button" variant="outline" onClick={() => setRecordActionMenuOpen((open) => !open)}>
                  Action
                </Button>
                {recordActionMenuOpen ? (
                  <div className="absolute left-0 z-40 mt-2 w-64 rounded-md border border-stone-200 bg-white p-1 shadow-lg">
                    {recordHeaderContext.actionMenu.map((action) => (
                      <button
                        key={action.label}
                        type="button"
                        onClick={() => {
                          setRecordActionMenuOpen(false);
                          action.onClick?.();
                        }}
                        className="block w-full rounded px-3 py-2 text-left text-sm font-semibold text-stone-700 hover:bg-stone-100"
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : recordHeaderContext?.actionsLeft && recordHeaderContext?.actions?.length ? (
              <div className="flex flex-wrap items-center gap-2">
                {recordHeaderContext.actions.map((action) => (
                  <Button key={action.label} type="button" variant="outline" className="gap-2" onClick={action.onClick}>
                    {action.icon === false ? null : <Plus className="h-4 w-4" />} {action.label}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
          {recordHeaderContext?.variant === "banking" ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {recordHeaderContext.actionMenu?.length ? (
                <div className="relative">
                  <Button type="button" variant="outline" onClick={() => setRecordActionMenuOpen((open) => !open)}>
                    Action
                  </Button>
                  {recordActionMenuOpen ? (
                    <div className="absolute right-0 z-40 mt-2 w-56 rounded-md border border-stone-200 bg-white p-1 shadow-lg">
                      {recordHeaderContext.actionMenu.map((action) => (
                        <button
                          key={action.label}
                          type="button"
                          onClick={() => {
                            setRecordActionMenuOpen(false);
                            action.onClick?.();
                          }}
                          className="block w-full rounded px-3 py-2 text-left text-sm font-semibold text-stone-700 hover:bg-stone-100"
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {!recordHeaderContext.actionsLeft ? recordHeaderContext.actions?.map((action) => (
                <Button key={action.label} type="button" variant="outline" className="gap-2" onClick={action.onClick}>
                  {action.icon === false ? null : <Plus className="h-4 w-4" />} {action.label}
                </Button>
              )) : null}
            </div>
          ) : recordHeaderContext?.tabs?.length ? (
            <div className="flex flex-wrap gap-2">
              {recordHeaderContext.tabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => recordHeaderContext.onTabChange?.(tab)}
                  className={`rounded-md px-3 py-2 text-sm font-semibold ${recordHeaderContext.activeTab === tab ? "bg-[var(--brand)] text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"}`}
                >
                  {tab}
                </button>
              ))}
              {!recordHeaderContext.actionsLeft ? recordHeaderContext.actions?.map((action) => (
                <Button key={action.label} type="button" variant="outline" className="gap-2" onClick={action.onClick}>
                  {action.icon === false ? null : <Plus className="h-4 w-4" />} {action.label}
                </Button>
              )) : null}
            </div>
          ) : recordHeaderContext?.actions?.length ? (
            <div className="flex flex-wrap gap-2">
              {recordHeaderContext.actions.map((action) => (
                <Button key={action.label} type="button" variant="outline" className="gap-2" onClick={action.onClick}>
                  {action.icon === false ? null : <Plus className="h-4 w-4" />} {action.label}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      </header>
      {showWorkspaceSearch ? <WorkspaceSearchBar value={filters.search} onChange={(search) => setFilters((current) => ({ ...current, search }))} /> : null}
      {renderTab()}
    </div>
  );
}

function LazyModuleWorkspace({ workspace, endpoint, field, children }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const clientId = workspace?.client?.id;
  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    setData(null);
    setError("");
    api.get(`/admin/accounting/clients/${clientId}/${endpoint}`)
      .then(({ data: response }) => { if (!cancelled) setData(response || {}); })
      .catch((requestError) => { if (!cancelled) setError(formatApiError(requestError)); });
    return () => { cancelled = true; };
  }, [clientId, endpoint]);
  if (error) return <Panel title="Module unavailable"><p className="py-8 text-center text-sm text-red-700">{error}</p></Panel>;
  if (!data) return <Panel title="Loading"><p className="py-8 text-center text-sm text-stone-500">Loading module data…</p></Panel>;
  return children({ ...workspace, [field]: data, ...(field === "vat_engine" ? { vat: data } : {}) });
}

function LazyGeneralLedger({ workspace, moduleTab, filters, detail, setHeaderContext }) {
  if (moduleTab === "Transactions") return <PaginatedGlTransactions workspace={workspace} filters={filters} />;
  if (moduleTab === "Journals") return <PaginatedGlJournals workspace={workspace} filters={filters} setHeaderContext={setHeaderContext} />;
  if (moduleTab === "Account Activity") return <PaginatedGlAccountActivity workspace={workspace} filters={filters} />;
  return <PlaceholderModulePanel title={moduleTab} moduleTitle={detail.title} />;
}

function LegacyLazyGeneralLedger({ workspace, moduleTab, filters, detail }) {
  const [journals, setJournals] = useState([]);
  const [reports, setReports] = useState(null);
  const [error, setError] = useState("");
  const clientId = workspace?.client?.id;
  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    setError("");
    Promise.all([
      Promise.resolve({ data: { rows: [] } }),
      Promise.resolve({ data: {} }),
    ]).then(([journalResponse, reportResponse]) => {
      if (cancelled) return;
      setJournals(Array.isArray(journalResponse.data?.rows) ? journalResponse.data.rows : []);
      setReports(reportResponse.data || {});
    }).catch((requestError) => { if (!cancelled) setError(formatApiError(requestError)); });
    return () => { cancelled = true; };
  }, [clientId]);
  if (error) return <Panel title="General Ledger unavailable"><p className="py-8 text-center text-sm text-red-700">{error}</p></Panel>;
  if (!reports) return <Panel title="Loading"><p className="py-8 text-center text-sm text-stone-500">Loading General Ledger…</p></Panel>;
  const loaded = { ...workspace, journals, reports };
  if (moduleTab === "Transactions") return <TransactionsWorkspace workspace={loaded} filters={filters} />;
  if (moduleTab === "Journals") return <JournalTable journals={journals} />;
  if (moduleTab === "Account Activity") return <AccountActivityWorkspace workspace={loaded} filters={filters} />;
  return <PlaceholderModulePanel title={moduleTab} moduleTitle={detail.title} />;
}

function glQueryParams(filters, page, pageSize, extra = {}) {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  const values = {
    date_from: filters?.date_from,
    date_to: filters?.date_to,
    financial_year: filters?.financial_year_id,
    period: filters?.period_id,
    search: filters?.search,
    location_id: filters?.location_id,
    dimension_id: filters?.dimension_id,
    group_by: filters?.group_by,
    ...extra,
  };
  Object.entries(values).forEach(([key, value]) => { if (value) params.set(key, value); });
  return params;
}

function useGlPage(workspace, endpoint, filters, page, pageSize, extra = {}) {
  const [data, setData] = useState(() => normalisePaginatedResponse({ page_size: DEFAULT_PAGE_SIZE }));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const clientId = workspace?.client?.id;
  const requestParams = useMemo(() => glQueryParams(filters, page, pageSize, extra).toString(), [extra, filters, page, pageSize]);
  const accountCode = extra.account_code;
  useEffect(() => {
    if (!clientId || (endpoint === "account-activity" && !accountCode)) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    api.get(`/admin/accounting/clients/${clientId}/gl/${endpoint}?${requestParams}`)
      .then(({ data: response }) => { if (!cancelled) setData(normalisePaginatedResponse(response, pageSize)); })
      .catch((requestError) => {
        if (!cancelled) {
          setData(normalisePaginatedResponse({ page, page_size: pageSize }));
          setError(formatApiError(requestError));
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accountCode, clientId, endpoint, page, pageSize, requestParams]);
  return { data, loading, error };
}

function GlActivityTable({ rows, exportFileName = "general-ledger-rows.csv" }) {
  const [selectedKeys, setSelectedKeys] = useState([]);
  if (!rows.length) return <p className="py-10 text-center text-sm text-stone-500">No ledger rows match the selected filters.</p>;
  const keyFor = (row, index) => String(row.id || `${row.journal_id}-${row.account_code}-${row.date}-${index}`);
  const selectedRows = rows.filter((row, index) => selectedKeys.includes(keyFor(row, index)));
  const allSelected = selectedRows.length === rows.length;
  return (
    <div>
      {selectedRows.length ? (
        <div className="flex items-center justify-between gap-3 border-b border-stone-200 bg-stone-50 px-3 py-2">
          <span className="text-sm font-semibold">{selectedRows.length} selected</span>
          <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => downloadReportCsv(exportFileName, selectedRows)}>
            <Download className="h-4 w-4" /> Export selected
          </Button>
        </div>
      ) : null}
      <div className="overflow-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
          <tr><th className="w-10 px-3 py-2"><input type="checkbox" aria-label="Select all ledger rows" checked={allSelected} onChange={(event) => setSelectedKeys(event.target.checked ? rows.map(keyFor) : [])} /></th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Reference</th><th className="px-3 py-2">Account</th><th className="px-3 py-2">Description</th><th className="px-3 py-2">Source</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th></tr>
        </thead>
        <tbody>{rows.map((row, index) => {
          const keyValue = keyFor(row, index);
          return (
          <tr key={keyValue} className="border-t border-stone-100">
            <td className="px-3 py-2"><input type="checkbox" aria-label={`Select ${row.reference || "ledger row"}`} checked={selectedKeys.includes(keyValue)} onChange={(event) => setSelectedKeys((current) => event.target.checked ? [...current, keyValue] : current.filter((key) => key !== keyValue))} /></td>
            <td className="px-3 py-2">{formatDate(row.date)}</td><td className="px-3 py-2 font-medium text-stone-900">{row.reference || "-"}</td><td className="px-3 py-2">{row.account_code} - {row.account_name}</td><td className="px-3 py-2 text-stone-600">{row.description || "-"}</td><td className="px-3 py-2 text-stone-500">{row.source_module || "General Ledger"}</td><td className="px-3 py-2 text-right">{formatMoney(row.debit)}</td><td className="px-3 py-2 text-right">{formatMoney(row.credit)}</td>
          </tr>
        );})}</tbody>
      </table>
      </div>
    </div>
  );
}

function GlPagination({ data, loading, setPage, setPageSize, disabled = false }) {
  return <PaginationFooter page={data.page} pageSize={data.page_size} totalRows={data.total_rows} totalPages={data.total_pages} onPageChange={setPage} onPageSizeChange={setPageSize} disabled={loading || disabled} />;
}

function PaginatedGlTransactions({ workspace, filters }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  useEffect(() => { setPage(1); }, [filters?.date_from, filters?.date_to, filters?.financial_year_id, filters?.period_id, filters?.search, filters?.location_id, filters?.dimension_id, pageSize]);
  const { data, loading, error } = useGlPage(workspace, "transactions", filters, page, pageSize);
  return <Panel title="Transactions">{error ? <p className="py-8 text-center text-sm text-red-700">{error}</p> : loading && !data.rows.length ? <p className="py-8 text-center text-sm text-stone-500">Loading transactions...</p> : <GlActivityTable rows={data.rows} />}<GlPagination data={data} loading={loading} setPage={setPage} setPageSize={setPageSize} /></Panel>;
}

function PaginatedGlJournals({ workspace, filters, setHeaderContext }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedIds, setSelectedIds] = useState([]);
  const [openId, setOpenId] = useState("");
  const [detail, setDetail] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [modalDraft, setModalDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [journalTab, setJournalTab] = useState("posted");
  const [importOpen, setImportOpen] = useState(false);
  const clientId = workspace?.client?.id;
  const accounts = (workspace?.accounts || []).filter((account) => account.active !== false);
  const [analyticalOptions, setAnalyticalOptions] = useState({ locations: [], dimensions: [] });
  useEffect(() => {
    if (!clientId) return;
    Promise.all([
      api.get(`/admin/accounting/clients/${clientId}/locations?page=1&page_size=250`),
      api.get(`/admin/accounting/clients/${clientId}/dimensions?page=1&page_size=250`),
    ]).then(([locations, dimensions]) => setAnalyticalOptions({
      locations: normalisePaginatedResponse(locations.data).rows,
      dimensions: normalisePaginatedResponse(dimensions.data).rows,
    })).catch(() => setAnalyticalOptions({ locations: [], dimensions: [] }));
  }, [clientId]);
  useEffect(() => { setPage(1); setSelectedIds([]); setOpenId(""); setDetail(null); }, [journalTab, filters?.date_from, filters?.date_to, filters?.financial_year_id, filters?.period_id, filters?.search, filters?.location_id, filters?.dimension_id, pageSize]);
  const { data, loading, error } = useGlPage(workspace, "journals", filters, page, pageSize, { status: journalTab, _refresh: refreshKey });
  const refresh = () => setRefreshKey((value) => value + 1);
  const openAddJournal = useCallback(() => setModalDraft(emptyJournalDraft(data.summary?.next_reference, clientId)), [clientId, data.summary?.next_reference]);
  const openImportJournal = useCallback(() => setImportOpen(true), []);
  const changeJournalTab = useCallback((tab) => setJournalTab(String(tab).startsWith("Drafts") ? "draft" : "posted"), []);
  useEffect(() => {
    const postedLabel = "Posted Journals";
    const draftsLabel = `Drafts (${data.summary?.draft_count || 0})`;
    setHeaderContext?.({ tabs: [postedLabel, draftsLabel], activeTab: journalTab === "draft" ? draftsLabel : postedLabel, onTabChange: changeJournalTab, actions: [{ label: "Add Journal", onClick: openAddJournal }, { label: "Import Journal", onClick: openImportJournal, icon: false }] });
    return () => setHeaderContext?.(null);
  }, [changeJournalTab, data.summary?.draft_count, journalTab, openAddJournal, openImportJournal, setHeaderContext]);
  async function loadJournalDetail(journalId) {
    const { data: response } = await api.get(`/admin/accounting/clients/${clientId}/general-ledger/journals/${journalId}`);
    setDetail(response);
  }
  async function toggleJournal(row) {
    if (openId === row.journal_id) { setOpenId(""); setDetail(null); setEditMode(false); return; }
    setOpenId(row.journal_id); setDetail(null); setEditMode(false);
    try { await loadJournalDetail(row.journal_id); }
    catch (requestError) { toast.error(formatApiError(requestError)); setOpenId(""); }
  }
  async function saveJournal(draft, closeModal = false) {
    const validation = validateJournalDraft(draft);
    if (validation) return toast.error(validation);
    setSaving(true);
    try {
      if (closeModal) await api.post(`/admin/accounting/clients/${clientId}/general-ledger/journals`, draft);
      else { const { data: response } = await api.patch(`/admin/accounting/clients/${clientId}/general-ledger/journals/${openId}`, draft); setDetail(response); setEditMode(false); }
      toast.success(closeModal ? "Journal created" : "Journal saved");
      if (closeModal) setModalDraft(null);
      refresh();
    } catch (requestError) { toast.error(formatApiError(requestError)); } finally { setSaving(false); }
  }
  function copyToModal(sourceDetail) {
    if (!sourceDetail) return;
    setModalDraft({ client_id: clientId, entry_date: new Date().toISOString().slice(0, 10), reference: data.summary?.next_reference || "", description: sourceDetail.journal?.description || "", status: "draft", default_location_id: sourceDetail.journal?.default_location_id || "", default_dimension_id: sourceDetail.journal?.default_dimension_id || "", lines: (sourceDetail.lines || []).map((line) => ({ account_code: line.account_code, description: line.description || "", debit: line.debit || "0.00", credit: line.credit || "0.00", vat_code: line.vat_code || "", location_id: line.location_id || "", dimension_id: line.dimension_id || "" })) });
  }
  async function copySelected() {
    if (selectedIds.length !== 1) return toast.error("Copy supports one selected journal at a time.");
    try { const { data: response } = await api.get(`/admin/accounting/clients/${clientId}/general-ledger/journals/${selectedIds[0]}`); copyToModal(response); }
    catch (requestError) { toast.error(formatApiError(requestError)); }
  }
  async function deleteSelected(ids = selectedIds) {
    if (!ids.length || !window.confirm(`Delete ${ids.length} selected journal${ids.length === 1 ? "" : "s"}?`)) return;
    try {
      const { data: response } = await api.post(`/admin/accounting/clients/${clientId}/general-ledger/journals/bulk-delete`, { journal_ids: ids });
      const blocked = (response.results || []).filter((row) => !row.deleted);
      if (blocked.length) toast.error(blocked.map((row) => row.reason).join(" ")); else toast.success("Journal deleted");
      setSelectedIds([]); setOpenId(""); setDetail(null); refresh();
    } catch (requestError) { toast.error(formatApiError(requestError)); }
  }
  return (
    <Panel title="Journals">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div />
        {selectedIds.length ? <div className="flex items-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-2"><span className="text-sm font-semibold">{selectedIds.length} selected</span><Button type="button" variant="outline" className="gap-2" onClick={() => downloadReportCsv("general-ledger-journals.csv", data.rows.filter((row) => selectedIds.includes(row.journal_id)))}><Download className="h-4 w-4" />Export</Button><Button type="button" variant="outline" disabled={selectedIds.length !== 1} onClick={copySelected}>Copy</Button><Button type="button" variant="destructive" disabled={journalTab !== "draft"} title={journalTab !== "draft" ? "Only deletable draft journals can be removed." : ""} onClick={() => deleteSelected()}>Delete</Button></div> : null}
      </div>
      {data.rows.length ? <label className="mb-2 inline-flex items-center gap-2 text-sm text-stone-600"><input type="checkbox" aria-label="Select all journals on this page" checked={data.rows.every((row) => selectedIds.includes(row.journal_id))} onChange={(event) => setSelectedIds(event.target.checked ? data.rows.map((row) => row.journal_id) : [])} /> Select all on this page</label> : null}
      {error ? <p className="py-8 text-center text-sm text-red-700">{error}</p> : loading && !data.rows.length ? <p className="py-8 text-center text-sm text-stone-500">Loading journals...</p> : data.rows.length ? (
        <div className="overflow-auto"><table className="min-w-full text-left text-sm"><thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Select</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Reference</th><th className="px-3 py-2">Description</th><th className="px-3 py-2">Source</th><th className="px-3 py-2 text-right">Lines</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th><th className="px-3 py-2">Status</th></tr></thead><tbody>{data.rows.map((row) => <React.Fragment key={row.journal_id}><tr onClick={() => toggleJournal(row)} className={`cursor-pointer border-t border-stone-100 ${openId === row.journal_id ? "bg-emerald-50" : "hover:bg-stone-50"}`}><td className="px-3 py-2"><input type="checkbox" checked={selectedIds.includes(row.journal_id)} onClick={(event) => event.stopPropagation()} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, row.journal_id] : current.filter((id) => id !== row.journal_id))} /></td><td className="px-3 py-2">{formatDate(row.date)}</td><td className="px-3 py-2 font-medium text-stone-900">{row.reference || "-"}</td><td className="px-3 py-2 text-stone-600">{row.description || "-"}</td><td className="px-3 py-2">{row.source_module}</td><td className="px-3 py-2 text-right">{row.line_count}</td><td className="px-3 py-2 text-right">{formatMoney(row.debit_total)}</td><td className="px-3 py-2 text-right">{formatMoney(row.credit_total)}</td><td className="px-3 py-2"><Badge variant="outline">{row.status || "posted"}</Badge></td></tr>{openId === row.journal_id ? <tr className="bg-emerald-50/40"><td colSpan="9" className="p-3">{detail ? <GlJournalEditor detail={detail} accounts={accounts} editMode={editMode} setEditMode={setEditMode} onChange={setDetail} onSave={saveJournal} onCancel={async () => { setEditMode(false); await loadJournalDetail(row.journal_id); }} onCopy={() => copyToModal(detail)} onDelete={() => deleteSelected([row.journal_id])} onClose={() => toggleJournal(row)} saving={saving} /> : <p className="py-6 text-center text-sm text-stone-500">Loading journal detail...</p>}</td></tr> : null}</React.Fragment>)}</tbody></table></div>
      ) : <p className="py-10 text-center text-sm text-stone-500">{journalTab === "draft" ? "No draft journals found." : "No posted journals match the selected filters."}</p>}
      <GlPagination data={data} loading={loading} setPage={setPage} setPageSize={setPageSize} />
      {modalDraft ? <GlJournalModal draft={modalDraft} setDraft={setModalDraft} accounts={accounts} analyticalOptions={analyticalOptions} saving={saving} onSave={saveJournal} onClose={() => setModalDraft(null)} /> : null}
      {importOpen ? <GlJournalImportModal clientId={clientId} onClose={() => setImportOpen(false)} onImported={() => { setImportOpen(false); setJournalTab("draft"); refresh(); }} /> : null}
    </Panel>
  );
}

function emptyJournalDraft(reference = "", clientId = "") {
  return { client_id: clientId, entry_date: new Date().toISOString().slice(0, 10), reference, description: "", status: "draft", default_location_id: "", default_dimension_id: "", lines: [{ account_code: "", description: "", debit: "", credit: "", vat_code: "", location_id: "", dimension_id: "" }, { account_code: "", description: "", debit: "", credit: "", vat_code: "", location_id: "", dimension_id: "" }] };
}

function WorkspaceSearchBar({ value, onChange }) {
  return (
    <section className="rounded-md border border-stone-200 bg-white p-3">
      <div className="max-w-2xl">
        <Input
          value={value || ""}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Search reference, account or contact..."
          className="h-9"
        />
      </div>
    </section>
  );
}

function validateJournalDraft(draft = {}) {
  if ((draft.lines || []).length < 2) return "A journal requires at least two lines.";
  let debit = 0; let credit = 0;
  for (const line of draft.lines || []) {
    const lineDebit = Number(line.debit || 0); const lineCredit = Number(line.credit || 0);
    if (!line.account_code) return "Every journal line requires a nominal account.";
    if (lineDebit < 0 || lineCredit < 0) return "Debit and credit values cannot be negative.";
    if (lineDebit && lineCredit) return "A journal line cannot contain both a debit and a credit.";
    if (!lineDebit && !lineCredit) return "Every journal line requires a debit or credit value.";
    debit += lineDebit; credit += lineCredit;
  }
  if (Math.abs(debit - credit) > 0.005) return "Journal debits and credits must balance.";
  return "";
}

function GlJournalFields(props) {
  const lines = props.draft?.lines || [];
  const clientId = props.draft?.client_id;
  const [analyticalOptions, setAnalyticalOptions] = useState({ locations: [], dimensions: [] });
  useEffect(() => {
    if (!clientId) return;
    Promise.all([
      api.get(`/admin/accounting/clients/${clientId}/locations?page=1&page_size=250`),
      api.get(`/admin/accounting/clients/${clientId}/dimensions?page=1&page_size=250`),
    ]).then(([locations, dimensions]) => setAnalyticalOptions({
      locations: normalisePaginatedResponse(locations.data).rows,
      dimensions: normalisePaginatedResponse(dimensions.data).rows,
    })).catch(() => setAnalyticalOptions({ locations: [], dimensions: [] }));
  }, [clientId]);
  const debit = lines.reduce((total, line) => total + Number(line.debit || 0), 0);
  const credit = lines.reduce((total, line) => total + Number(line.credit || 0), 0);
  const difference = debit - credit;
  const balanced = debit > 0 && credit > 0 && Math.abs(difference) <= 0.005;
  return <div className="space-y-3"><GlJournalFieldsBody {...props} analyticalOptions={analyticalOptions} /><div className={`grid gap-3 rounded-md border p-3 sm:grid-cols-4 ${balanced ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}><div><p className="text-xs uppercase text-stone-500">Total debit</p><p className="font-semibold">{formatMoney(debit)}</p></div><div><p className="text-xs uppercase text-stone-500">Total credit</p><p className="font-semibold">{formatMoney(credit)}</p></div><div><p className="text-xs uppercase text-stone-500">Difference</p><p className="font-semibold">{formatMoney(Math.abs(difference))}</p></div><div className={`self-center font-semibold ${balanced ? "text-emerald-700" : "text-amber-800"}`}>{balanced ? "Balanced" : "Out of balance"}</div></div></div>;
}

function GlJournalFieldsBody({ draft, setDraft, accounts, disabled, analyticalOptions = { locations: [], dimensions: [] } }) {
  const setLine = (index, key, value) => setDraft((current) => ({ ...current, lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, [key]: value } : line) }));
  if (analyticalOptions) return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-5">
        <Field label="Journal date" type="date" value={draft.entry_date || draft.date} disabled={disabled} onChange={(value) => setDraft((current) => ({ ...current, entry_date: value }))} />
        <Field label="Reference" value={draft.reference} disabled={disabled} onChange={(value) => setDraft((current) => ({ ...current, reference: value }))} />
        <Field label="Description" value={draft.description} disabled={disabled} onChange={(value) => setDraft((current) => ({ ...current, description: value }))} />
        <SelectField label="Location" value={draft.default_location_id || ""} disabled={disabled} onChange={(value) => setDraft((current) => ({ ...current, default_location_id: value }))} options={[["", "No location"], ...(analyticalOptions.locations || []).filter((row) => row.status !== "inactive" || row.id === draft.default_location_id).map((row) => [row.id, `${row.code} - ${row.name}${row.status === "inactive" ? " (inactive)" : ""}`])]} />
        <SelectField label="Dimension" value={draft.default_dimension_id || ""} disabled={disabled} onChange={(value) => setDraft((current) => ({ ...current, default_dimension_id: value }))} options={[["", "No dimension"], ...(analyticalOptions.dimensions || []).filter((row) => row.status !== "inactive" || row.id === draft.default_dimension_id).map((row) => [row.id, `${row.dimension_type_name}: ${row.code} - ${row.name}${row.status === "inactive" ? " (inactive)" : ""}`])]} />
      </div>
      <div className="overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-stone-50 text-xs uppercase text-stone-500"><tr><th className="px-2 py-2">Nominal</th><th className="px-2 py-2">Description</th><th className="px-2 py-2">Location</th><th className="px-2 py-2">Dimension</th><th className="px-2 py-2">VAT code</th><th className="px-2 py-2 text-right">Debit</th><th className="px-2 py-2 text-right">Credit</th>{!disabled ? <th /> : null}</tr></thead>
          <tbody>{(draft.lines || []).map((line, index) => <tr key={line.id || index} className="border-t border-stone-100">
            <td className="p-2"><select disabled={disabled} value={line.account_code || ""} onChange={(event) => setLine(index, "account_code", event.target.value)} className="h-9 min-w-48 rounded-md border border-stone-200 px-2"><option value="">Select nominal</option>{accounts.map((account) => <option key={account.id || account.code} value={account.code}>{account.code} - {account.name}</option>)}</select></td>
            <td className="p-2"><Input disabled={disabled} value={line.description || ""} onChange={(event) => setLine(index, "description", event.target.value)} /></td>
            <td className="p-2"><select disabled={disabled} value={line.location_id || ""} onChange={(event) => setLine(index, "location_id", event.target.value)} className="h-9 min-w-40 rounded-md border border-stone-200 px-2"><option value="">Inherit header</option>{(analyticalOptions.locations || []).filter((row) => row.status !== "inactive" || row.id === line.location_id).map((row) => <option key={row.id} value={row.id}>{row.code} - {row.name}{row.status === "inactive" ? " (inactive)" : ""}</option>)}</select></td>
            <td className="p-2"><select disabled={disabled} value={line.dimension_id || ""} onChange={(event) => setLine(index, "dimension_id", event.target.value)} className="h-9 min-w-48 rounded-md border border-stone-200 px-2"><option value="">Inherit header</option>{(analyticalOptions.dimensions || []).filter((row) => row.status !== "inactive" || row.id === line.dimension_id).map((row) => <option key={row.id} value={row.id}>{row.dimension_type_name}: {row.code} - {row.name}{row.status === "inactive" ? " (inactive)" : ""}</option>)}</select></td>
            <td className="p-2"><Input disabled={disabled} value={line.vat_code || ""} onChange={(event) => setLine(index, "vat_code", event.target.value)} /></td>
            <td className="p-2"><Input disabled={disabled} type="number" min="0" step="0.01" value={line.debit || ""} onChange={(event) => setLine(index, "debit", event.target.value)} /></td>
            <td className="p-2"><Input disabled={disabled} type="number" min="0" step="0.01" value={line.credit || ""} onChange={(event) => setLine(index, "credit", event.target.value)} /></td>
            {!disabled ? <td className="p-2"><Button type="button" variant="outline" size="sm" disabled={draft.lines.length <= 2} onClick={() => setDraft((current) => ({ ...current, lines: current.lines.filter((_, lineIndex) => lineIndex !== index) }))}>Remove</Button></td> : null}
          </tr>)}</tbody>
        </table>
      </div>
      {!disabled ? <Button type="button" variant="outline" onClick={() => setDraft((current) => ({ ...current, lines: [...current.lines, { account_code: "", description: "", debit: "", credit: "", vat_code: "", location_id: "", dimension_id: "" }] }))}>Add line</Button> : null}
    </div>
  );
  return <div className="space-y-3"><div className="grid gap-3 md:grid-cols-3"><Field label="Journal date" type="date" value={draft.entry_date || draft.date} disabled={disabled} onChange={(value) => setDraft((current) => ({ ...current, entry_date: value }))} /><Field label="Reference" value={draft.reference} disabled={disabled} onChange={(value) => setDraft((current) => ({ ...current, reference: value }))} /><Field label="Description" value={draft.description} disabled={disabled} onChange={(value) => setDraft((current) => ({ ...current, description: value }))} /></div><div className="overflow-auto"><table className="min-w-full text-sm"><thead className="bg-stone-50 text-xs uppercase text-stone-500"><tr><th className="px-2 py-2">Nominal</th><th className="px-2 py-2">Description</th><th className="px-2 py-2">VAT code</th><th className="px-2 py-2 text-right">Debit</th><th className="px-2 py-2 text-right">Credit</th>{!disabled ? <th /> : null}</tr></thead><tbody>{(draft.lines || []).map((line, index) => <tr key={line.id || index} className="border-t border-stone-100"><td className="p-2"><select disabled={disabled} value={line.account_code || ""} onChange={(event) => setLine(index, "account_code", event.target.value)} className="h-9 min-w-48 rounded-md border border-stone-200 px-2"><option value="">Select nominal</option>{accounts.map((account) => <option key={account.id || account.code} value={account.code}>{account.code} - {account.name}</option>)}</select></td><td className="p-2"><Input disabled={disabled} value={line.description || ""} onChange={(event) => setLine(index, "description", event.target.value)} /></td><td className="p-2"><Input disabled={disabled} value={line.vat_code || ""} onChange={(event) => setLine(index, "vat_code", event.target.value)} /></td><td className="p-2"><Input disabled={disabled} type="number" min="0" step="0.01" value={line.debit || ""} onChange={(event) => setLine(index, "debit", event.target.value)} /></td><td className="p-2"><Input disabled={disabled} type="number" min="0" step="0.01" value={line.credit || ""} onChange={(event) => setLine(index, "credit", event.target.value)} /></td>{!disabled ? <td className="p-2"><Button type="button" variant="outline" size="sm" disabled={draft.lines.length <= 2} onClick={() => setDraft((current) => ({ ...current, lines: current.lines.filter((_, lineIndex) => lineIndex !== index) }))}>Remove</Button></td> : null}</tr>)}</tbody></table></div>{!disabled ? <Button type="button" variant="outline" onClick={() => setDraft((current) => ({ ...current, lines: [...current.lines, { account_code: "", description: "", debit: "", credit: "", vat_code: "" }] }))}>Add line</Button> : null}</div>;
}

function GlJournalEditor({ detail, accounts, editMode, setEditMode, onChange, onSave, onCancel, onCopy, onDelete, onClose, saving }) {
  const draft = { ...detail.journal, entry_date: detail.journal?.entry_date, lines: detail.lines || [] };
  const setDraft = (updater) => { const next = typeof updater === "function" ? updater(draft) : updater; onChange((current) => ({ ...current, journal: { ...current.journal, ...next }, lines: next.lines || current.lines })); };
  return <div className="rounded-md border border-emerald-200 bg-white"><header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 bg-stone-50 p-3"><div><div className="font-semibold">{detail.journal?.reference || "Journal"}</div><div className="text-xs text-stone-500">{formatDate(detail.journal?.entry_date)} · {detail.journal?.source_type || "General Ledger"} · {detail.journal?.status || "posted"}</div></div><div className="flex flex-wrap gap-2">{!editMode ? <><Button type="button" variant="outline" onClick={onCopy}>Copy to new journal</Button><Button type="button" variant="outline" disabled={!detail.editable} title={!detail.editable ? detail.lock_reason || "This journal is read-only." : ""} onClick={() => setEditMode(true)}>Edit</Button><Button type="button" variant="outline" onClick={onClose}>Close</Button></> : <><Button type="button" variant="outline" onClick={onCancel}>Cancel</Button><Button type="button" disabled={saving} onClick={() => onSave(draft)}>Save</Button>{detail.journal?.status === "draft" ? <Button type="button" disabled={saving} onClick={() => onSave({ ...draft, status: "posted" })}>Post</Button> : null}</>}{detail.deletable ? <Button type="button" variant="destructive" onClick={onDelete}>Delete</Button> : null}</div></header>{!detail.editable && detail.lock_reason ? <div className="m-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{detail.lock_reason}</div> : null}<div className="p-3"><GlJournalFields draft={draft} setDraft={setDraft} accounts={accounts} disabled={!editMode} /></div></div>;
}

function LegacyGlJournalEditor({ detail, accounts, editMode, setEditMode, onChange, onSave, onCancel, onCopy, onDelete, onClose, saving }) {
  const draft = { ...detail.journal, entry_date: detail.journal?.entry_date, lines: detail.lines || [] };
  const setDraft = (updater) => { const next = typeof updater === "function" ? updater(draft) : updater; onChange((current) => ({ ...current, journal: { ...current.journal, ...next }, lines: next.lines || current.lines })); };
  return <div className="rounded-md border border-emerald-200 bg-white"><header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 bg-stone-50 p-3"><div><div className="font-semibold">{detail.journal?.reference || "Journal"}</div><div className="text-xs text-stone-500">{formatDate(detail.journal?.entry_date)} · {detail.journal?.source_type || "General Ledger"} · {detail.journal?.status || "posted"}</div></div><div className="flex flex-wrap gap-2">{!editMode && detail.editable ? <Button type="button" variant="outline" onClick={() => setEditMode(true)}>Edit</Button> : null}{editMode ? <><Button type="button" variant="outline" onClick={onCancel}>Cancel</Button><Button type="button" disabled={saving} onClick={() => onSave(draft)}>Save</Button></> : null}<Button type="button" variant="outline" onClick={onCopy}>Copy to new journal</Button>{detail.deletable ? <Button type="button" variant="destructive" onClick={onDelete}>Delete</Button> : null}<Button type="button" variant="outline" onClick={onClose}>Close</Button></div></header>{!detail.editable && detail.delete_blockers?.length ? <div className="m-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{detail.delete_blockers[0]}</div> : null}<div className="p-3"><GlJournalFields draft={draft} setDraft={setDraft} accounts={accounts} disabled={!editMode} /></div></div>;
}

function GlJournalModal({ draft, setDraft, accounts, saving, onSave, onClose }) {
  useEffect(() => { const previous = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = previous; }; }, []);
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true"><div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"><header className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-white p-4"><div><h3 className="font-display text-lg font-semibold">New journal</h3><p className="text-sm text-stone-500">Manual General Ledger journal</p></div><div className="flex gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="button" variant="outline" disabled={saving} onClick={() => onSave({ ...draft, status: "draft" }, true)}>Save draft</Button><Button type="button" disabled={saving} onClick={() => onSave({ ...draft, status: "posted" }, true)} style={{ background: "var(--brand)" }}>Post journal</Button></div></header><div className="min-h-0 flex-1 overflow-y-auto p-4"><GlJournalFields draft={draft} setDraft={setDraft} accounts={accounts} disabled={false} /></div></div></div>;
}

function GlJournalImportModal({ clientId, onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  useEffect(() => { const previous = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = previous; }; }, []);
  async function downloadTemplate() {
    try {
      const response = await api.get(`/admin/accounting/clients/${clientId}/general-ledger/journals/import-template`, { responseType: "blob" });
      const url = URL.createObjectURL(response.data); const link = document.createElement("a");
      link.href = url; link.download = "journal-import-template.csv"; link.click(); URL.revokeObjectURL(url);
    } catch (requestError) { toast.error(formatApiError(requestError)); }
  }
  async function importFile() {
    if (!file) return toast.error("Choose a CSV or XLSX journal file first.");
    setBusy(true); setResult(null);
    try {
      const form = new FormData(); form.append("file", file);
      const { data } = await api.post(`/admin/accounting/clients/${clientId}/general-ledger/journals/import`, form);
      setResult(data); if (data.imported_count) toast.success(`${data.imported_count} draft journal${data.imported_count === 1 ? "" : "s"} imported.`);
    } catch (requestError) { toast.error(formatApiError(requestError)); } finally { setBusy(false); }
  }
  return <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true"><div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"><header className="flex items-center justify-between border-b border-stone-200 p-4"><div><h3 className="font-display text-lg font-semibold">Import Journal</h3><p className="text-sm text-stone-500">Imported journals are saved as drafts for review.</p></div><Button type="button" variant="outline" onClick={onClose}>Close</Button></header><div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4"><p className="text-sm text-stone-600">Upload CSV or XLSX with: journal_date, reference, description, line_description, nominal_code, vat_code, debit, credit.</p><Button type="button" variant="outline" onClick={downloadTemplate}><Download className="mr-2 h-4 w-4" />Download sample template</Button><Input type="file" accept=".csv,.xlsx" onChange={(event) => setFile(event.target.files?.[0] || null)} />{result ? <div className="rounded-md border border-stone-200 bg-stone-50 p-3 text-sm"><p className="font-semibold">Imported: {result.imported_count || 0}</p>{(result.failed_rows || []).length ? <ul className="mt-2 space-y-1 text-red-700">{result.failed_rows.map((failure, index) => <li key={`${failure.row || failure.reference}-${index}`}>Row {failure.row || "-"}: {failure.message}</li>)}</ul> : <p className="mt-1 text-emerald-700">All rows passed validation.</p>}</div> : null}</div><footer className="flex justify-end gap-2 border-t border-stone-200 p-4"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="button" disabled={busy || !file} onClick={importFile}>{busy ? "Importing..." : "Import as drafts"}</Button>{result?.imported_count ? <Button type="button" variant="outline" onClick={onImported}>View drafts</Button> : null}</footer></div></div>;
}

function PaginatedGlAccountActivity({ workspace, filters }) {
  const accounts = useMemo(() => (workspace?.accounts || []).filter((account) => account.active !== false), [workspace?.accounts]);
  const [accountCode, setAccountCode] = useState(() => accounts[0]?.code || "");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  useEffect(() => { if (!accountCode && accounts[0]?.code) setAccountCode(accounts[0].code); }, [accountCode, accounts]);
  useEffect(() => { setPage(1); }, [accountCode, filters?.date_from, filters?.date_to, filters?.financial_year_id, filters?.period_id, filters?.search, filters?.location_id, filters?.dimension_id, pageSize]);
  const { data, loading, error } = useGlPage(workspace, "account-activity", filters, page, pageSize, { account_code: accountCode });
  return (
    <Panel title="Account activity">
      <div className="mb-3 max-w-md"><AccountCodeSelect label="Nominal account" accounts={accounts} value={accountCode} onChange={setAccountCode} /></div>
      {!accountCode ? <p className="py-10 text-center text-sm text-stone-500">Select an account to load activity.</p> : error ? <p className="py-8 text-center text-sm text-red-700">{error}</p> : loading && !data.rows.length ? <p className="py-8 text-center text-sm text-stone-500">Loading account activity...</p> : <GlActivityTable rows={data.rows} />}
      <GlPagination data={data} loading={loading} setPage={setPage} setPageSize={setPageSize} disabled={!accountCode} />
    </Panel>
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

function AccountingFilterBar({ workspace, module, filters, setFilters }) {
  const years = workspace.financial_years || [];
  const periods = workspace.periods || [];
  const clientId = workspace?.client?.id;
  const [analyticalOptions, setAnalyticalOptions] = useState({ locations: [], dimensions: [] });
  useEffect(() => {
    if (!clientId || !["gl", "reports"].includes(module)) return;
    let cancelled = false;
    Promise.all([
      api.get(`/admin/accounting/clients/${clientId}/locations?page=1&page_size=250&status=active`),
      api.get(`/admin/accounting/clients/${clientId}/dimensions?page=1&page_size=250&status=active`),
    ]).then(([locations, dimensions]) => {
      if (!cancelled) setAnalyticalOptions({
        locations: normalisePaginatedResponse(locations.data).rows,
        dimensions: normalisePaginatedResponse(dimensions.data).rows,
      });
    }).catch(() => {
      if (!cancelled) setAnalyticalOptions({ locations: [], dimensions: [] });
    });
    return () => { cancelled = true; };
  }, [clientId, module]);
  const filteredPeriods = filters.financial_year_id ? periods.filter((period) => period.financial_year_id === filters.financial_year_id) : periods;
  return (
    <section className="rounded-md border border-stone-200 bg-white p-3">
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
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
        {["gl", "reports"].includes(module) ? <>
          <AnalyticalSearchInput
            label="Location"
            value={filters.location_id}
            options={analyticalOptions.locations}
            onChange={(location_id) => setFilters((current) => ({ ...current, location_id }))}
            placeholder="All locations"
          />
          <AnalyticalSearchInput
            label="Dimension"
            value={filters.dimension_id}
            options={analyticalOptions.dimensions}
            onChange={(dimension_id) => setFilters((current) => ({ ...current, dimension_id }))}
            placeholder="All dimensions"
            dimension
          />
        </> : null}
        {module === "reports" ? <select
          value={filters.group_by || ""}
          onChange={(event) => setFilters((current) => ({ ...current, group_by: event.target.value }))}
          className="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm"
          aria-label="Report grouping"
        >
          <option value="">No analytical grouping</option>
          <option value="location">Profit and Loss by Location</option>
          <option value="dimension">Profit and Loss by Dimension</option>
          <option value="location_dimension">Profit and Loss by Dimension and Location</option>
        </select> : null}
        <div className="flex flex-wrap gap-2 xl:col-span-4">
        <Button type="button" variant="outline" className="h-9 gap-2"><RefreshCw className="h-4 w-4" /> Refresh</Button>
        <Button type="button" variant="outline" className="h-9 gap-2"><Download className="h-4 w-4" /> Export</Button>
        <Button type="button" variant="outline" className="h-9 gap-2"><Printer className="h-4 w-4" /> Print</Button>
        </div>
      </div>
    </section>
  );
}

function AnalyticalSearchInput({ label, value, options = [], onChange, placeholder, dimension = false }) {
  const listId = React.useId();
  const optionLabel = (item) => dimension
    ? `${item.dimension_type_name || "Dimension"}: ${item.code} - ${item.name}`
    : `${item.code} - ${item.name}`;
  const selected = options.find((item) => String(item.id) === String(value || ""));
  const selectedLabel = selected ? optionLabel(selected) : "";
  const [text, setText] = useState(selectedLabel);
  useEffect(() => { setText(selectedLabel); }, [selectedLabel]);
  return <div>
    <Label className="sr-only">{label}</Label>
    <Input
      list={listId}
      value={text}
      placeholder={placeholder}
      className="h-9"
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        const match = options.find((item) => optionLabel(item) === next || item.code === next);
        onChange(match?.id || (next === "" ? "" : value));
      }}
    />
    <datalist id={listId}>{options.map((item) => <option key={item.id} value={optionLabel(item)} />)}</datalist>
  </div>;
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

function FixedAssetsWorkspace({ workspace, tab, search = "", reloadWorkspace, busy }) {
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
  const [assetModalOpen, setAssetModalOpen] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categoryForm, setCategoryForm] = useState({ name: "", description: "", default_useful_life_months: 36, default_depreciation_method: "straight_line", default_residual_value: "0.00", fixed_asset_account: settings.default_fixed_asset_account || "1500", accumulated_depreciation_account: settings.default_accumulated_depreciation_account || "1590", depreciation_expense_account: settings.default_depreciation_expense_account || "7000", active: true });
  const [assetForm, setAssetForm] = useState({ asset_name: "", description: "", category_id: "", location: "", department: "", supplier_id: "", supplier_name: "", purchase_date: "", in_service_date: "", purchase_cost: "", residual_value: "0.00", useful_life_months: 36, depreciation_method: "straight_line", fixed_asset_account: settings.default_fixed_asset_account || "1500", accumulated_depreciation_account: settings.default_accumulated_depreciation_account || "1590", depreciation_expense_account: settings.default_depreciation_expense_account || "7000", notes: "" });
  const [actionForm, setActionForm] = useState({ asset_id: "", date: "", amount: "", location: "", department: "", notes: "", disposal_type: "sale" });
  const [settingsForm, setSettingsForm] = useState(settings);
  const searchNeedle = String(search || "").trim().toLowerCase();
  const matchesSearch = (row) => !searchNeedle || Object.values(row || {}).some((value) => (
    ["string", "number"].includes(typeof value) && String(value).toLowerCase().includes(searchNeedle)
  ));
  const visibleAssets = assets.filter(matchesSearch);
  const visibleCategories = categories.filter(matchesSearch);
  const visibleSchedule = schedule.filter(matchesSearch);

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
      setCategoryModalOpen(false);
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
      setAssetModalOpen(false);
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
      <div className="space-y-4">
        <div className="flex justify-end">
          <Button type="button" className="gap-2" onClick={() => setAssetModalOpen(true)} style={{ background: "var(--brand)" }}>
            <Plus className="h-4 w-4" /> Create asset
          </Button>
        </div>
        {assetModalOpen ? (
        <FixedAssetFormModal title="Create asset" onClose={() => setAssetModalOpen(false)}>
          <form onSubmit={submitAsset} className="space-y-3">
            <Field label="Asset name" value={assetForm.asset_name} onChange={(value) => setAssetForm((current) => ({ ...current, asset_name: value }))} />
            <Field label="Description" value={assetForm.description} onChange={(value) => setAssetForm((current) => ({ ...current, description: value }))} />
            <div className="grid gap-3 md:grid-cols-2">
              <SelectField label="Category" value={assetForm.category_id} onChange={applyCategory} options={categories.filter((c) => c.active).map((c) => [c.id, c.name])} />
              <SelectField
                label="Supplier"
                value={assetForm.supplier_id}
                onChange={applySupplier}
                options={suppliers
                  .filter((supplier) => supplier.status !== "inactive")
                  .map((supplier) => [
                    supplier.id,
                    `${supplier.supplier_code ? `${supplier.supplier_code} - ` : ""}${supplier.name || supplier.trading_name || "Supplier"}`,
                  ])}
              />
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
            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-stone-200 bg-white pt-3">
              <Button type="button" variant="outline" onClick={() => setAssetModalOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving || busy}>Create asset</Button>
            </div>
          </form>
        </FixedAssetFormModal>
        ) : null}
        <Panel title="Asset register">
          <ReportTable selectable exportFileName="fixed-assets.csv" rows={visibleAssets} columns={[["asset_code", "Asset ID"], ["asset_name", "Asset"], ["category_name", "Category"], ["location", "Location"], ["purchase_date", "Purchase", "date"], ["purchase_cost", "Cost", "money"], ["accumulated_depreciation", "Depreciation", "money"], ["net_book_value", "NBV", "money"], ["status", "Status"]]} empty="No assets match the current search." />
        </Panel>
      </div>
    );
  }

  if (tab === "Asset Categories") {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <Button type="button" className="gap-2" onClick={() => setCategoryModalOpen(true)} style={{ background: "var(--brand)" }}>
            <Plus className="h-4 w-4" /> Add category
          </Button>
        </div>
        {categoryModalOpen ? (
        <FixedAssetFormModal title="Add asset category" onClose={() => setCategoryModalOpen(false)} maxWidth="max-w-3xl">
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
            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-stone-200 bg-white pt-3">
              <Button type="button" variant="outline" onClick={() => setCategoryModalOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving || busy}>Save category</Button>
            </div>
          </form>
        </FixedAssetFormModal>
        ) : null}
        <Panel title="Categories">
          <ReportTable selectable exportFileName="fixed-asset-categories.csv" rows={visibleCategories} columns={[["name", "Category"], ["default_depreciation_method", "Method"], ["default_useful_life_months", "Life months"], ["fixed_asset_account", "Asset account"], ["accumulated_depreciation_account", "Accumulated"], ["depreciation_expense_account", "Expense"], ["active", "Active"]]} empty="No categories match the current search." />
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
          <ReportTable selectable exportFileName="depreciation-schedule.csv" rows={visibleSchedule} columns={[["asset_code", "Asset"], ["asset_name", "Name"], ["period_label", "Period"], ["opening_nbv", "Opening NBV", "money"], ["charge", "Charge", "money"], ["accumulated_depreciation", "Accumulated", "money"], ["closing_nbv", "Closing NBV", "money"], ["status", "Status"]]} empty="No depreciation rows match the current search." />
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
        <ReportTable selectable exportFileName="fixed-asset-disposals.csv" rows={reports.asset_disposals || []} columns={[["asset_code", "Asset"], ["asset_name", "Name"], ["disposal_date", "Date", "date"], ["disposal_proceeds", "Proceeds", "money"], ["status", "Status"]]} empty="No disposals yet." />
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
        <ReportTable selectable exportFileName="fixed-asset-transfers.csv" rows={events.filter((event) => event.event_type === "transfer")} columns={[["event_date", "Date", "date"], ["asset_id", "Asset"], ["from_value", "From"], ["to_value", "To"], ["notes", "Notes"]]} empty="No transfers recorded." />
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
        <ReportTable selectable exportFileName="fixed-asset-revaluations.csv" rows={reports.revaluations || []} columns={[["event_date", "Date", "date"], ["asset_id", "Asset"], ["from_value", "From"], ["to_value", "To"], ["amount", "Movement", "money"], ["notes", "Notes"]]} empty="No revaluations posted." />
      </div>
    );
  }

  if (tab === "Reports") {
    return (
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Net book value summary"><ReportTable selectable exportFileName="fixed-asset-nbv-summary.csv" rows={reports.nbv_summary || []} columns={[["category", "Category"], ["count", "Assets"], ["cost", "Cost", "money"], ["nbv", "NBV", "money"]]} empty="No asset summary yet." /></Panel>
        <Panel title="Category analysis"><ReportTable selectable exportFileName="fixed-asset-category-analysis.csv" rows={reports.category_analysis || []} columns={[["category", "Category"], ["count", "Assets"], ["cost", "Cost", "money"], ["nbv", "NBV", "money"]]} empty="No category analysis yet." /></Panel>
        <Panel title="Asset additions"><ReportTable selectable exportFileName="fixed-asset-additions.csv" rows={reports.asset_additions || []} columns={[["asset_code", "Asset"], ["asset_name", "Name"], ["purchase_date", "Date", "date"], ["purchase_cost", "Cost", "money"]]} empty="No additions this year." /></Panel>
        <Panel title="Depreciation schedule"><ReportTable selectable exportFileName="fixed-asset-report-depreciation.csv" rows={reports.depreciation_schedule || []} columns={[["asset_code", "Asset"], ["period_label", "Period"], ["charge", "Charge", "money"], ["closing_nbv", "Closing NBV", "money"]]} empty="No schedule yet." /></Panel>
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

function FixedAssetFormModal({ title, onClose, children, maxWidth = "max-w-5xl" }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`flex max-h-[calc(100dvh-2rem)] w-full ${maxWidth} flex-col overflow-hidden rounded-lg bg-white shadow-2xl`}>
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-white px-4 py-3">
          <h3 className="font-display text-lg font-semibold text-stone-900">{title}</h3>
          <Button type="button" variant="outline" onClick={onClose}>Close</Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
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

function VatEngineWorkspace({ workspace, tab, filters, reloadWorkspace, busy }) {
  const sourceVat = useMemo(() => workspace?.vat_engine || {}, [workspace?.vat_engine]);
  const clientId = workspace?.client?.id;
  const [refreshedVat, setRefreshedVat] = useState(null);
  const vat = refreshedVat || sourceVat;
  const settings = useMemo(() => vat.settings || {}, [vat.settings]);
  const vatClient = workspace?.vat_status?.vat_client ?? workspace?.client?.is_vat_client ?? false;
  const codes = vat.codes || [];
  const activeCodes = codes.filter((code) => code.active !== false);
  const periods = vat.periods || [];
  const dashboard = vat.dashboard || {};
  const vatActivitySummary = vat.activity_summary || {};
  const currentPeriod = periods.find((period) => period.id === dashboard.current_period_id) || periods.find((period) => period.status === "open") || periods[0];
  const [search, setSearch] = useState("");
  const [vatCodeFilter, setVatCodeFilter] = useState("");
  const [settingsForm, setSettingsForm] = useState(settings);
  const [showBasisConfirmation, setShowBasisConfirmation] = useState(false);
  const [basisConfirmation, setBasisConfirmation] = useState("");
  const [codeForm, setCodeForm] = useState({ code: "", description: "", percentage: "20", purchase_behavior: "input", sales_behavior: "output", return_box_net: "7", return_box_vat: "4", active: true });
  const [adjustmentForm, setAdjustmentForm] = useState({ adjustment_date: "", vat_period_id: "", vat_code: "", direction: "", reason: "", source_reference: "", notes: "", net_amount: "", vat_amount: "", gross_amount: "" });
  const [vatPage, setVatPage] = useState(() => normalisePaginatedResponse({ page_size: DEFAULT_PAGE_SIZE }));
  const [vatPageNumber, setVatPageNumber] = useState(1);
  const [vatPageSize, setVatPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [vatPageLoading, setVatPageLoading] = useState(false);
  const [vatPageError, setVatPageError] = useState("");
  const [vatRefreshKey, setVatRefreshKey] = useState(0);
  const [showCreateCode, setShowCreateCode] = useState(false);
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
  const [expandedAdjustmentId, setExpandedAdjustmentId] = useState("");
  const [adjustmentDetails, setAdjustmentDetails] = useState({});
  const [adjustmentDetailLoading, setAdjustmentDetailLoading] = useState("");
  const [adjustmentDetailError, setAdjustmentDetailError] = useState("");
  const setAdjustmentValue = (key, value) => {
    setAdjustmentForm((current) => {
      const next = { ...current, [key]: value };
      if (key !== "gross_amount" && key !== "vat_code") return next;
      const calculated = calculateVatInclusiveAmounts(
        key === "gross_amount" ? value : current.gross_amount,
        key === "vat_code" ? value : current.vat_code,
        activeCodes
      );
      return calculated ? { ...next, net_amount: calculated.net, vat_amount: calculated.vat } : next;
    });
  };

  useEffect(() => {
    const basis = settings?.vat_accounting_basis || (settings?.cash_accounting ? "cash" : "accrual");
    setSettingsForm({ ...(settings || {}), vat_accounting_basis: basis, vat_scheme: settings?.vat_scheme === "flat_rate" ? "flat_rate" : "standard" });
  }, [settings]);

  useEffect(() => {
    setRefreshedVat(null);
  }, [clientId]);

  useEffect(() => {
    if (!showAdjustmentModal) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [showAdjustmentModal]);

  useEffect(() => {
    if (!adjustmentForm.vat_period_id && currentPeriod?.id) {
      setAdjustmentForm((current) => ({ ...current, vat_period_id: currentPeriod.id }));
    }
  }, [currentPeriod?.id, adjustmentForm.vat_period_id]);

  const paginatedVatTabs = useMemo(() => ({ "VAT Transactions": "transactions", Adjustments: "adjustments" }), []);
  useEffect(() => { setVatPageNumber(1); }, [tab, search, vatCodeFilter, filters?.date_from, filters?.date_to, filters?.financial_year_id, filters?.period_id, filters?.search, vatPageSize]);
  useEffect(() => {
    const endpoint = paginatedVatTabs[tab];
    if (!endpoint || !clientId) return;
    let cancelled = false;
    const params = new URLSearchParams({ page: String(vatPageNumber), page_size: String(vatPageSize) });
    const values = { date_from: filters?.date_from, date_to: filters?.date_to, financial_year: filters?.financial_year_id, period: filters?.period_id, vat_code: vatCodeFilter, search: search || filters?.search };
    Object.entries(values).forEach(([key, value]) => { if (value) params.set(key, value); });
    setVatPageLoading(true); setVatPageError("");
    api.get(`/admin/accounting/clients/${clientId}/vat/${endpoint}?${params.toString()}`)
      .then(({ data }) => { if (!cancelled) setVatPage(normalisePaginatedResponse(data, vatPageSize)); })
      .catch((requestError) => { if (!cancelled) { setVatPageError(formatApiError(requestError)); setVatPage(normalisePaginatedResponse({ page: vatPageNumber, page_size: vatPageSize })); } })
      .finally(() => { if (!cancelled) setVatPageLoading(false); });
    return () => { cancelled = true; };
  }, [clientId, tab, vatPageNumber, vatPageSize, search, vatCodeFilter, filters?.date_from, filters?.date_to, filters?.financial_year_id, filters?.period_id, filters?.search, vatRefreshKey, paginatedVatTabs]);

  async function runVatAction(action, successMessage) {
    try {
      const result = await action();
      toast.success(successMessage);
      const [{ data }] = await Promise.all([
        api.get(`/admin/accounting/clients/${clientId}/vat/workspace`),
        reloadWorkspace?.(),
      ]);
      setRefreshedVat(data || {});
      setVatRefreshKey((key) => key + 1);
      return result;
    } catch (e) {
      toast.error(formatApiError(e));
      return null;
    }
  }

  const submitPeriod = (period) => runVatAction(
    () => api.post(`/admin/accounting/clients/${clientId}/vat/periods/${period.id}/submit`),
    "VAT return submitted and the next period opened"
  );

  const createCode = (event) => {
    event.preventDefault();
    return runVatAction(
      () => api.post(`/admin/accounting/clients/${clientId}/vat/codes`, codeForm),
      "VAT code created"
    ).then(() => {
      setCodeForm({ code: "", description: "", percentage: "20", purchase_behavior: "input", sales_behavior: "output", return_box_net: "7", return_box_vat: "4", active: true });
      setShowCreateCode(false);
    });
  };

  const updateCode = (code, values) => runVatAction(
    () => api.put(`/admin/accounting/clients/${clientId}/vat/codes/${code.id}`, values),
    "VAT code updated"
  );

  const deleteCode = (code) => runVatAction(
    () => api.delete(`/admin/accounting/clients/${clientId}/vat/codes/${code.id}`),
    "VAT code removed"
  );

  const persistSettings = (confirmation = "") => runVatAction(
    () => api.put(`/admin/accounting/clients/${clientId}/vat/settings`, {
      ...settingsForm,
      vat_accounting_basis: settingsForm.vat_accounting_basis || "accrual",
      cash_accounting: settingsForm.vat_accounting_basis === "cash",
      accrual_accounting: settingsForm.vat_accounting_basis !== "cash",
      basis_change_confirmation: confirmation,
    }),
    "VAT settings saved"
  ).then((result) => {
    if (result) {
      setShowBasisConfirmation(false);
      setBasisConfirmation("");
    }
    return result;
  });

  const saveSettings = (event) => {
    event.preventDefault();
    if (vatClient && (!settingsForm.vat_start_date || !settingsForm.vat_scheme || !settingsForm.vat_accounting_basis || !settingsForm.vat_frequency)) {
      toast.error("VAT start date, scheme, accounting basis and frequency are required before VAT treatment can be applied.");
      return;
    }
    if (settingsForm.vat_start_date && settingsForm.vat_end_date && settingsForm.vat_end_date < settingsForm.vat_start_date) {
      toast.error("VAT end date cannot be before VAT start date.");
      return;
    }
    const currentBasis = settings?.vat_accounting_basis || (settings?.cash_accounting ? "cash" : "accrual");
    if (settingsForm.vat_accounting_basis !== currentBasis && vatActivitySummary.requires_confirmation) {
      setShowBasisConfirmation(true);
      return;
    }
    return persistSettings();
  };

  const createAdjustment = (event) => {
    event.preventDefault();
    return runVatAction(
      () => api.post(`/admin/accounting/clients/${clientId}/vat/adjustments`, adjustmentForm),
      "VAT adjustment posted"
    ).then((result) => {
      if (result) {
        setAdjustmentForm({ adjustment_date: "", vat_period_id: currentPeriod?.id || "", vat_code: "", direction: "", reason: "", source_reference: "", notes: "", net_amount: "", vat_amount: "", gross_amount: "" });
        setShowAdjustmentModal(false);
      }
      return result;
    });
  };

  const toggleAdjustmentDetail = async (adjustment) => {
    const id = String(adjustment?.id || "");
    if (!id) return;
    if (expandedAdjustmentId === id) {
      setExpandedAdjustmentId("");
      setAdjustmentDetailError("");
      return;
    }
    setExpandedAdjustmentId(id);
    setAdjustmentDetailError("");
    if (adjustmentDetails[id]) return;
    setAdjustmentDetailLoading(id);
    try {
      const { data } = await api.get(`/admin/accounting/clients/${clientId}/vat/adjustments/${id}`);
      setAdjustmentDetails((current) => ({ ...current, [id]: data || {} }));
    } catch (error) {
      setAdjustmentDetailError(formatApiError(error));
    } finally {
      setAdjustmentDetailLoading("");
    }
  };

  if (tab === "VAT Returns") {
    return (
      <Panel title="VAT returns">
        <VatPeriodTable periods={periods} clientId={clientId} onSubmit={submitPeriod} busy={busy} />
      </Panel>
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
        {vatPageError ? <p className="py-8 text-center text-sm text-red-700">{vatPageError}</p> : vatPageLoading && !vatPage.rows.length ? <p className="py-8 text-center text-sm text-stone-500">Loading VAT transactions...</p> : <VatTransactionsTable transactions={vatPage.rows} />}
        <PaginationFooter page={vatPage.page} pageSize={vatPage.page_size} totalRows={vatPage.total_rows} totalPages={vatPage.total_pages} onPageChange={setVatPageNumber} onPageSizeChange={setVatPageSize} disabled={vatPageLoading} />
      </Panel>
    );
  }

  if (tab === "VAT Codes") {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <Button type="button" onClick={() => setShowCreateCode((shown) => !shown)} style={{ background: "var(--brand)" }}>
            {showCreateCode ? "Cancel create" : "Create VAT code"}
          </Button>
        </div>
        {showCreateCode && <Panel title="Create VAT code">
          <form onSubmit={createCode} className="space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Code" value={codeForm.code} onChange={(value) => setCodeForm((current) => ({ ...current, code: value }))} />
              <Field label="Display name / description" value={codeForm.description} onChange={(value) => setCodeForm((current) => ({ ...current, description: value }))} />
              <Field label="Rate %" type="number" value={codeForm.percentage} onChange={(value) => setCodeForm((current) => ({ ...current, percentage: value }))} />
              <VatSelect label="Direction / category" value={codeForm.category || "both"} onChange={(value) => setCodeForm((current) => ({ ...current, category: value }))} options={["purchase", "sales", "both", "other"]} />
              <VatSelect label="Purchase behaviour" value={codeForm.purchase_behavior} onChange={(value) => setCodeForm((current) => ({ ...current, purchase_behavior: value }))} options={["recoverable", "zero", "exempt", "reverse_charge", "outside_scope"]} />
              <VatSelect label="Sales behaviour" value={codeForm.sales_behavior} onChange={(value) => setCodeForm((current) => ({ ...current, sales_behavior: value }))} options={["output", "zero", "exempt", "reverse_charge", "outside_scope"]} />
              <Field label="Net box" value={codeForm.return_box_net} onChange={(value) => setCodeForm((current) => ({ ...current, return_box_net: value }))} />
              <Field label="VAT box" value={codeForm.return_box_vat} onChange={(value) => setCodeForm((current) => ({ ...current, return_box_vat: value }))} />
            </div>
            <label className="flex items-center gap-2 text-sm font-semibold text-stone-700">
              <input type="checkbox" checked={!!codeForm.active} onChange={(e) => setCodeForm((current) => ({ ...current, active: e.target.checked }))} />
              Active
            </label>
            <div className="flex justify-end"><Button disabled={busy} style={{ background: "var(--brand)" }}>Create code</Button></div>
          </form>
        </Panel>}
        <Panel title="VAT codes">
          <VatCodeTable codes={codes} busy={busy} onUpdate={updateCode} onDelete={deleteCode} />
        </Panel>
      </div>
    );
  }

  if (tab === "Adjustments") {
    return (
      <div className="space-y-3">
        <div className="flex justify-end">
          <Button type="button" onClick={() => setShowAdjustmentModal(true)} style={{ background: "var(--brand)" }}>New VAT adjustment</Button>
        </div>
        <Panel title="VAT adjustments">
          <div className="space-y-2">
            {vatPage.rows.map((adjustment) => {
              const expanded = expandedAdjustmentId === adjustment.id;
              const detail = adjustmentDetails[adjustment.id];
              const source = detail?.source || {};
              const doubleEntry = detail?.double_entry || {};
              return <div key={adjustment.id} className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
                <button type="button" onClick={() => toggleAdjustmentDetail(adjustment)} className="grid w-full gap-3 p-3 text-left transition hover:bg-stone-50 md:grid-cols-[24px_120px_minmax(240px,1fr)_150px_120px_120px] md:items-center">
                  <span className={`text-lg text-stone-500 transition ${expanded ? "rotate-90" : ""}`}>›</span>
                  <Info label="Date" value={formatDate(adjustment.adjustment_date)} />
                  <Info label="Reason" value={adjustment.reason || adjustment.notes || "VAT adjustment"} />
                  <Info label="Source" value={adjustment.source_reference || String(adjustment.source_type || "Manual").replaceAll("_", " ")} />
                  <Info label="VAT code" value={adjustment.vat_code || "-"} />
                  <Info label="VAT" value={formatMoney(adjustment.vat_amount)} />
                </button>
                {expanded && <div className="border-t border-stone-200 bg-stone-50 p-4">
                  {adjustmentDetailLoading === adjustment.id ? <p className="py-6 text-center text-sm text-stone-500">Loading adjustment detail...</p> : adjustmentDetailError ? <p className="py-6 text-center text-sm text-red-700">{adjustmentDetailError}</p> : detail ? <div className="space-y-4">
                    <section className="rounded-lg border border-stone-200 bg-white p-4">
                      <h4 className="font-display font-bold text-stone-900">Why this adjustment happened</h4>
                      <p className="mt-1 text-sm text-stone-700">{source.explanation || adjustment.notes || adjustment.reason || "Manual VAT correction"}</p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <Info label="Adjustment type" value={String(source.source_type || adjustment.adjustment_type || "manual").replaceAll("_", " ")} />
                        <Info label="Source reference" value={source.source_reference || "-"} />
                        <Info label="Original period" value={source.original_vat_period?.label || "-"} />
                        <Info label="Reported period" value={source.reported_vat_period?.label || "-"} />
                        {source.invoice && <Info label="Invoice" value={source.invoice.invoice_number || source.invoice.reference || source.invoice.id} />}
                        {source.payment_or_receipt && <Info label="Payment / receipt" value={source.payment_or_receipt.reference || source.payment_or_receipt.id} />}
                        {source.bank_transaction && <Info label="Bank transaction" value={`${formatDate(source.bank_transaction.transaction_date)} · ${source.bank_transaction.reference || source.bank_transaction.description || source.bank_transaction.id}`} />}
                      </div>
                    </section>
                    <section className="overflow-hidden rounded-lg border border-stone-300 bg-white">
                      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 bg-stone-100 px-4 py-3">
                        <div><h4 className="font-display font-bold text-stone-900">Double entry</h4><p className="text-xs text-stone-600">{doubleEntry.explanation}</p></div>
                        {doubleEntry.journal_id && <Badge variant="outline">Journal {doubleEntry.journal?.reference || doubleEntry.journal_id}</Badge>}
                      </div>
                      {doubleEntry.lines?.length ? <div className="overflow-auto"><table className="min-w-full text-left text-sm"><thead className="bg-stone-50 text-xs uppercase text-stone-500"><tr><th className="px-4 py-2">Account</th><th className="px-4 py-2">Description</th><th className="px-4 py-2">VAT code</th><th className="px-4 py-2 text-right">Debit</th><th className="px-4 py-2 text-right">Credit</th></tr></thead><tbody>{doubleEntry.lines.map((line) => <tr key={line.id} className="border-t border-stone-100"><td className="px-4 py-2 font-medium">{line.account_code} - {line.account_name}</td><td className="px-4 py-2 text-stone-600">{line.description || "-"}</td><td className="px-4 py-2">{line.vat_code || "-"}</td><td className="px-4 py-2 text-right">{Number(line.debit || 0) ? formatMoney(line.debit) : "-"}</td><td className="px-4 py-2 text-right">{Number(line.credit || 0) ? formatMoney(line.credit) : "-"}</td></tr>)}</tbody><tfoot className="border-t-2 border-stone-300 bg-stone-50 font-bold"><tr><td colSpan="3" className="px-4 py-2 text-right">Totals</td><td className="px-4 py-2 text-right">{formatMoney(doubleEntry.debit_total)}</td><td className="px-4 py-2 text-right">{formatMoney(doubleEntry.credit_total)}</td></tr></tfoot></table></div> : <p className="p-4 text-sm text-stone-600">No separate General Ledger journal was created for this reporting-only VAT correction.</p>}
                    </section>
                  </div> : null}
                </div>}
              </div>;
            })}
            {!vatPageLoading && vatPage.rows.length === 0 && <p className="py-10 text-center text-sm text-stone-500">No VAT adjustments posted yet.</p>}
            {vatPageError && <p className="py-4 text-center text-sm text-red-700">{vatPageError}</p>}
          </div>
          <PaginationFooter page={vatPage.page} pageSize={vatPage.page_size} totalRows={vatPage.total_rows} totalPages={vatPage.total_pages} onPageChange={setVatPageNumber} onPageSizeChange={setVatPageSize} disabled={vatPageLoading} />
        </Panel>
        {showAdjustmentModal && <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-labelledby="vat-adjustment-title">
          <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            <header className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-white px-5 py-4"><div><h3 id="vat-adjustment-title" className="font-display text-lg font-bold">New VAT adjustment</h3><p className="text-sm text-stone-500">Post a balanced VAT correction to the General Ledger and VAT return.</p></div><Button type="button" variant="outline" onClick={() => setShowAdjustmentModal(false)}>Close</Button></header>
            <form onSubmit={createAdjustment} className="min-h-0 flex flex-1 flex-col overflow-hidden">
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Adjustment date" type="date" value={adjustmentForm.adjustment_date} onChange={(value) => setAdjustmentForm((current) => ({ ...current, adjustment_date: value }))} />
                  <VatSelect label="VAT period" value={adjustmentForm.vat_period_id} onChange={(value) => setAdjustmentForm((current) => ({ ...current, vat_period_id: value }))} options={periods.filter((period) => period.status === "open").map((period) => ({ value: period.id, label: period.label || `${formatDate(period.start_date)} - ${formatDate(period.end_date)}` }))} />
                  <VatSelect label="VAT code" value={adjustmentForm.vat_code} onChange={(value) => setAdjustmentValue("vat_code", value)} options={activeCodes.map((code) => ({ value: code.code, label: `${code.code} - ${code.description}`, percentage: code.percentage }))} />
                  <VatSelect label="Adjustment direction" value={adjustmentForm.direction} onChange={(value) => setAdjustmentForm((current) => ({ ...current, direction: value }))} options={[{ value: "increase_output", label: "Increase output VAT" }, { value: "decrease_output", label: "Decrease output VAT" }, { value: "increase_input", label: "Increase input VAT" }, { value: "decrease_input", label: "Decrease input VAT" }, { value: "net_adjustment", label: "Net adjustment" }]} />
                  <Field label="Reason" value={adjustmentForm.reason} onChange={(value) => setAdjustmentForm((current) => ({ ...current, reason: value }))} />
                  <Field label="Source reference" value={adjustmentForm.source_reference} onChange={(value) => setAdjustmentForm((current) => ({ ...current, source_reference: value }))} />
                  <Field label="Net" type="number" value={adjustmentForm.net_amount} onChange={(value) => setAdjustmentForm((current) => ({ ...current, net_amount: value }))} />
                  <Field label="VAT" type="number" value={adjustmentForm.vat_amount} onChange={(value) => setAdjustmentForm((current) => ({ ...current, vat_amount: value }))} />
                  <Field label="Gross" type="number" value={adjustmentForm.gross_amount} onChange={(value) => setAdjustmentValue("gross_amount", value)} />
                  <Field label="Notes / explanation" value={adjustmentForm.notes} onChange={(value) => setAdjustmentForm((current) => ({ ...current, notes: value }))} />
                </div>
                <VatAdjustmentDoubleEntryPreview form={adjustmentForm} />
              </div>
              <footer className="sticky bottom-0 flex justify-end gap-2 border-t border-stone-200 bg-white p-4"><Button type="button" variant="outline" onClick={() => setShowAdjustmentModal(false)}>Cancel</Button><Button disabled={busy} style={{ background: "var(--brand)" }}>Post VAT adjustment</Button></footer>
            </form>
          </div>
        </div>}
      </div>
    );
  }

  if (tab === "Settings") {
    return (
      <>
      <Panel title="VAT settings">
        <form onSubmit={saveSettings} className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Field label="VAT registration number" value={settingsForm.vat_registration_number || ""} onChange={(value) => setSettingsForm((current) => ({ ...current, vat_registration_number: value }))} />
            <VatSelect label={`VAT scheme${vatClient ? " *" : ""}`} value={settingsForm.vat_scheme || "standard"} onChange={(value) => setSettingsForm((current) => ({ ...current, vat_scheme: value }))} options={[{ value: "standard", label: "Standard" }, { value: "flat_rate", label: "Flat rate" }]} />
            <VatSelect label={`VAT accounting basis${vatClient ? " *" : ""}`} value={settingsForm.vat_accounting_basis || "accrual"} onChange={(value) => setSettingsForm((current) => ({ ...current, vat_accounting_basis: value }))} options={[{ value: "accrual", label: "Accrual — invoice/posting tax point" }, { value: "cash", label: "Cash — bank payment/receipt date" }]} />
            <VatSelect label={`VAT frequency${vatClient ? " *" : ""}`} value={settingsForm.vat_frequency || "quarterly"} onChange={(value) => setSettingsForm((current) => ({ ...current, vat_frequency: value }))} options={["monthly", "quarterly", "annual"]} />
            <Field label={`VAT start date${vatClient ? " *" : ""}`} type="date" value={settingsForm.vat_start_date || ""} onChange={(value) => setSettingsForm((current) => ({ ...current, vat_start_date: value }))} />
            <Field label="VAT end date" type="date" value={settingsForm.vat_end_date || ""} onChange={(value) => setSettingsForm((current) => ({ ...current, vat_end_date: value }))} />
            <Field label="Return due: months after period" type="number" value={settingsForm.return_due_months_after_period ?? 1} onChange={(value) => setSettingsForm((current) => ({ ...current, return_due_months_after_period: value }))} />
            <Field label="Return due: additional days" type="number" value={settingsForm.return_due_days_after_month ?? 7} onChange={(value) => setSettingsForm((current) => ({ ...current, return_due_days_after_month: value }))} />
            <Field label="Payment due: months after period" type="number" value={settingsForm.payment_due_months_after_period ?? 1} onChange={(value) => setSettingsForm((current) => ({ ...current, payment_due_months_after_period: value }))} />
            <Field label="Payment due: additional days" type="number" value={settingsForm.payment_due_days_after_month ?? 7} onChange={(value) => setSettingsForm((current) => ({ ...current, payment_due_days_after_month: value }))} />
            <VatSelect label="Default purchase VAT code" value={settingsForm.default_purchase_vat_code || ""} onChange={(value) => setSettingsForm((current) => ({ ...current, default_purchase_vat_code: value }))} options={activeCodes.map((code) => ({ value: code.code, label: `${code.code} - ${code.description}` }))} />
            <VatSelect label="Default sales VAT code" value={settingsForm.default_sales_vat_code || ""} onChange={(value) => setSettingsForm((current) => ({ ...current, default_sales_vat_code: value }))} options={activeCodes.map((code) => ({ value: code.code, label: `${code.code} - ${code.description}` }))} />
            <VatSelect label="Default bank VAT code" value={settingsForm.default_bank_vat_code || ""} onChange={(value) => setSettingsForm((current) => ({ ...current, default_bank_vat_code: value }))} options={activeCodes.map((code) => ({ value: code.code, label: `${code.code} - ${code.description}` }))} />
            <Field label="Flat rate percentage" type="number" value={settingsForm.flat_rate_percentage || ""} onChange={(value) => setSettingsForm((current) => ({ ...current, flat_rate_percentage: value }))} />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <VatCheckbox label="MTD ready" checked={!!settingsForm.mtd_enabled} onChange={(value) => setSettingsForm((current) => ({ ...current, mtd_enabled: value }))} />
          </div>
          <div className="flex justify-end">
            <Button disabled={busy} style={{ background: "var(--brand)" }}>Save VAT settings</Button>
          </div>
        </form>
      </Panel>
      {showBasisConfirmation && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-labelledby="vat-basis-warning-title">
          <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-amber-300 bg-white shadow-2xl">
            <header className="border-b border-amber-200 bg-amber-50 p-5">
              <h3 id="vat-basis-warning-title" className="font-display text-lg font-bold text-amber-950">Confirm VAT accounting basis change</h3>
            </header>
            <div className="space-y-4 p-5 text-sm text-stone-700">
              <p className="whitespace-pre-line">{vat.basis_change_warning || "Changing VAT accounting basis will alter when VAT is reported. Accrual accounting uses invoice/posting dates; cash accounting uses bank payment and receipt dates."}</p>
              <div className="grid gap-2 rounded-lg border border-stone-200 bg-stone-50 p-3 sm:grid-cols-3">
                <Info label="AP/AR documents" value={vatActivitySummary.document_count || 0} />
                <Info label="Bank allocations" value={vatActivitySummary.allocation_count || 0} />
                <Info label="Locked/submitted periods" value={vatActivitySummary.terminal_periods || 0} />
              </div>
              <Field label="Type CHANGE VAT BASIS to confirm" value={basisConfirmation} onChange={setBasisConfirmation} />
            </div>
            <footer className="flex justify-end gap-2 border-t border-stone-200 p-4">
              <Button type="button" variant="outline" onClick={() => { setShowBasisConfirmation(false); setBasisConfirmation(""); }}>Cancel</Button>
              <Button type="button" disabled={basisConfirmation !== "CHANGE VAT BASIS"} onClick={() => persistSettings(basisConfirmation)} style={{ background: "var(--brand)" }}>Change VAT basis</Button>
            </footer>
          </div>
        </div>
      )}
      </>
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
            {!compact && <th className="px-3 py-2">Return boxes</th>}
            {!compact && <th className="px-3 py-2">Period</th>}
            {!compact && <th className="px-3 py-2">Basis</th>}
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
              {!compact && <td className="px-3 py-2 text-xs text-stone-600">{transaction.direction === "purchase" ? `VAT → Box ${transaction.box_purchase_vat || "—"} · Net → Box ${transaction.box_purchase_net || "—"}` : `VAT → Box ${transaction.box_sales_vat || "—"} · Net → Box ${transaction.box_sales_net || "—"}`}</td>}
              {!compact && <td className="px-3 py-2 text-stone-500">{transaction.vat_period || "-"}</td>}
              {!compact && <td className="px-3 py-2 capitalize text-stone-600">{transaction.vat_accounting_basis || "-"}</td>}
              {!compact && <td className="px-3 py-2"><Badge className={transaction.status === "locked" ? "bg-stone-200 text-stone-700" : "bg-emerald-100 text-emerald-800"}>{transaction.status || "open"}</Badge></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VatCodeTable({ codes = [], busy, onUpdate, onDelete }) {
  const [expanded, setExpanded] = useState("");
  const [selected, setSelected] = useState([]);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [visible, setVisible] = useState({ category: true, purchase: true, sales: true, boxes: true, status: true });
  if (!codes.length) {
    return <p className="py-10 text-center text-sm text-stone-500">No VAT codes configured yet.</p>;
  }
  const toggle = (code) => {
    const next = expanded === code.id ? "" : code.id;
    setExpanded(next);
    setEditing(false);
    setEditForm(next ? { description: code.description || "", percentage: code.percentage || "0", purchase_behavior: code.purchase_behavior || "", sales_behavior: code.sales_behavior || "", active: code.active !== false } : {});
  };
  const exportSelected = () => {
    const rows = codes.filter((code) => selected.includes(code.id));
    if (!rows.length) return toast.error("Select at least one VAT code to export.");
    const csv = ["Code,Description,Rate,Purchase,Sales,Purchase boxes,Sales boxes,Status", ...rows.map((code) => [code.code, code.description, code.percentage, code.purchase_behavior, code.sales_behavior, (code.purchase_boxes || []).join(" "), (code.sales_boxes || []).join(" "), code.active ? "Active" : "Inactive"].map((value) => `"${String(value || "").replaceAll('"', '""')}"`).join(","))].join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = "vat-codes.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-3 text-xs text-stone-600">
          {Object.keys(visible).map((key) => <label key={key} className="flex items-center gap-1 capitalize"><input type="checkbox" checked={visible[key]} onChange={(e) => setVisible((current) => ({ ...current, [key]: e.target.checked }))} />{key}</label>)}
        </div>
        {selected.length > 0 && <Button type="button" size="sm" variant="outline" onClick={exportSelected}>Export selected ({selected.length})</Button>}
      </div>
      <div className="overflow-auto rounded-md border border-stone-200 bg-white">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
          <tr>
            <th className="w-10 px-3 py-2"><input type="checkbox" checked={selected.length === codes.length} onChange={(e) => setSelected(e.target.checked ? codes.map((code) => code.id) : [])} /></th>
            <th className="px-3 py-2">Code</th>
            <th className="px-3 py-2">Description</th>
            <th className="px-3 py-2 text-right">Rate</th>
            {visible.category && <th className="px-3 py-2">Category</th>}
            {visible.purchase && <th className="px-3 py-2">Purchase</th>}
            {visible.sales && <th className="px-3 py-2">Sales</th>}
            {visible.boxes && <th className="px-3 py-2">Return boxes</th>}
            {visible.status && <th className="px-3 py-2">Status</th>}
          </tr>
        </thead>
        <tbody>
          {codes.map((code) => (<React.Fragment key={code.id || code.code}>
            <tr className="cursor-pointer border-t border-stone-100 hover:bg-stone-50" onClick={() => toggle(code)}>
              <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selected.includes(code.id)} onChange={(e) => setSelected((current) => e.target.checked ? [...current, code.id] : current.filter((id) => id !== code.id))} /></td>
              <td className="px-3 py-2 font-semibold text-stone-900">{code.code}</td>
              <td className="px-3 py-2 text-stone-700">{code.description}</td>
              <td className="px-3 py-2 text-right">{Number(code.percentage || 0).toFixed(2)}%</td>
              {visible.category && <td className="px-3 py-2 capitalize text-stone-600">{code.category || "both"}</td>}
              {visible.purchase && <td className="px-3 py-2 text-stone-600">{code.purchase_behavior}</td>}
              {visible.sales && <td className="px-3 py-2 text-stone-600">{code.sales_behavior}</td>}
              {visible.boxes && <td className="px-3 py-2 text-xs text-stone-600"><div>Purchase: VAT → Box {code.return_box_mapping?.purchase_vat || "—"} · Net → Box {code.return_box_mapping?.purchase_net || "—"}</div><div>Sales: VAT → Box {code.return_box_mapping?.sales_vat || "—"} · Net → Box {code.return_box_mapping?.sales_net || "—"}</div></td>}
              {visible.status && <td className="px-3 py-2"><Badge className={code.active ? "bg-emerald-100 text-emerald-800" : "bg-stone-200 text-stone-700"}>{code.active ? "Active" : "Inactive"}</Badge></td>}
            </tr>
            {expanded === code.id && <tr className="border-t border-stone-100 bg-stone-50"><td colSpan="10" className="p-4">
              {!editing ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <Info label="Description" value={code.description || "—"} />
                <Info label="Rate" value={`${Number(code.percentage || 0).toFixed(2)}%`} />
                <Info label="Purchase behaviour" value={code.purchase_behavior || "—"} />
                <Info label="Sales behaviour" value={code.sales_behavior || "—"} />
                <Info label="History" value={code.has_history ? `${code.history_count || 0} transaction records` : "No transaction history"} />
              </div> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <Field label="Description" value={editForm.description || ""} onChange={(value) => setEditForm((current) => ({ ...current, description: value }))} />
                <Field label="Rate %" type="number" disabled={code.system_code || code.default_code || code.has_history} value={editForm.percentage || ""} onChange={(value) => setEditForm((current) => ({ ...current, percentage: value }))} />
                <VatSelect label="Purchase behaviour" disabled={code.system_code || code.default_code || code.has_history} value={editForm.purchase_behavior || ""} onChange={(value) => setEditForm((current) => ({ ...current, purchase_behavior: value }))} options={["recoverable", "zero", "exempt", "reverse_charge", "outside_scope"]} />
                <VatSelect label="Sales behaviour" disabled={code.system_code || code.default_code || code.has_history} value={editForm.sales_behavior || ""} onChange={(value) => setEditForm((current) => ({ ...current, sales_behavior: value }))} options={["output", "zero", "exempt", "reverse_charge", "outside_scope"]} />
                <VatCheckbox label="Active" checked={editForm.active !== false} onChange={(value) => setEditForm((current) => ({ ...current, active: value }))} />
              </div>}
              <div className="mt-3 flex justify-end gap-2">
                {!editing && !code.system_code && !code.default_code && !code.has_history && <Button type="button" variant="outline" disabled={busy} onClick={() => window.confirm(`Delete ${code.code}?`) && onDelete(code)}>Delete</Button>}
                {!editing ? <Button type="button" disabled={busy} onClick={() => setEditing(true)} style={{ background: "var(--brand)" }}>Edit</Button> : <>
                  <Button type="button" variant="outline" onClick={() => { setEditing(false); setEditForm({ description: code.description || "", percentage: code.percentage || "0", purchase_behavior: code.purchase_behavior || "", sales_behavior: code.sales_behavior || "", active: code.active !== false }); }}>Cancel</Button>
                  <Button type="button" disabled={busy} onClick={async () => { const result = await onUpdate(code, editForm); if (result) setEditing(false); }} style={{ background: "var(--brand)" }}>Save changes</Button>
                </>}
              </div>
              {(code.system_code || code.default_code) && <p className="mt-2 text-xs text-stone-500">Default/system VAT code: return mappings, rate and behaviours are locked. Its display description and active state may be maintained.</p>}
              {code.has_history && !code.system_code && !code.default_code && <p className="mt-2 text-xs text-stone-500">This code has transaction history, so its accounting mapping is locked and it cannot be deleted. Make it inactive to remove it from new-entry dropdowns.</p>}
            </td></tr>}
          </React.Fragment>))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function VatPeriodTable({ periods = [], clientId, onSubmit, busy }) {
  const [expandedPeriodId, setExpandedPeriodId] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const loadDetail = useCallback(async (periodId) => {
    if (!clientId || !periodId) return;
    setDetailLoading(true);
    setDetailError("");
    try {
      const { data } = await api.get(`/admin/accounting/clients/${clientId}/vat/periods/${periodId}`);
      setDetail(data || null);
    } catch (error) {
      setDetail(null);
      setDetailError(formatApiError(error));
    } finally {
      setDetailLoading(false);
    }
  }, [clientId]);

  const togglePeriod = (period) => {
    if (expandedPeriodId === period.id) {
      setExpandedPeriodId("");
      setDetail(null);
      setDetailError("");
      return;
    }
    setExpandedPeriodId(period.id);
    setDetail(null);
    loadDetail(period.id);
  };

  const submit = async (period) => {
    const confirmed = window.confirm(
      `Submit the VAT return for ${formatDate(period.start_date)} - ${formatDate(period.end_date)}? Submitted returns cannot be reopened or unsubmitted.`
    );
    if (!confirmed) return;
    const result = await onSubmit?.(period);
    if (result) await loadDetail(period.id);
  };

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
            <th className="px-3 py-2 text-right">Transactions</th>
            <th className="px-3 py-2 text-right">Output VAT</th>
            <th className="px-3 py-2 text-right">Input VAT</th>
            <th className="px-3 py-2 text-right">Net VAT</th>
            <th className="px-3 py-2 text-right">Status</th>
          </tr>
        </thead>
        <tbody>
          {periods.map((period) => (
            <React.Fragment key={period.id}>
              <tr
                className={`cursor-pointer border-t border-stone-100 hover:bg-stone-50 ${expandedPeriodId === period.id ? "bg-emerald-50/50" : ""}`}
                onClick={() => togglePeriod(period)}
              >
                <td className="px-3 py-2 font-semibold text-stone-900">
                  <span className="inline-flex items-center gap-2">
                    <ArrowRight className={`h-4 w-4 transition-transform ${expandedPeriodId === period.id ? "rotate-90" : ""}`} />
                    {formatDate(period.start_date)} - {formatDate(period.end_date)}
                  </span>
                </td>
                <td className="px-3 py-2">{formatDate(period.due_date)}</td>
                <td className="px-3 py-2 text-right">{period.transaction_count || 0}</td>
                <td className="px-3 py-2 text-right">{formatMoney(period.output_vat)}</td>
                <td className="px-3 py-2 text-right">{formatMoney(period.input_vat)}</td>
                <td className="px-3 py-2 text-right font-semibold">{formatMoney(period.net_vat)}</td>
                <td className="px-3 py-2 text-right">
                  <Badge className={period.status === "submitted" ? "bg-stone-200 text-stone-700" : "bg-emerald-100 text-emerald-800"}>
                    {period.status === "submitted" ? "Submitted" : "Open"}
                  </Badge>
                </td>
              </tr>
              {expandedPeriodId === period.id ? (
                <tr className="border-t border-stone-100 bg-stone-50/60">
                  <td colSpan="7" className="p-4">
                    {detailLoading ? <p className="py-10 text-center text-sm text-stone-500">Loading VAT return...</p> : null}
                    {detailError ? <p className="py-10 text-center text-sm text-red-700">{detailError}</p> : null}
                    {!detailLoading && detail ? (
                      <VatPeriodReturnDetail
                        detail={detail}
                        clientId={clientId}
                        period={period}
                        busy={busy}
                        onSubmit={() => submit(period)}
                      />
                    ) : null}
                  </td>
                </tr>
              ) : null}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VatPeriodReturnDetail({ detail, clientId, period, busy, onSubmit }) {
  const [openBox, setOpenBox] = useState(null);
  const vatReturn = detail.return || {};
  const status = detail.period?.status || period.status;
  return (
    <div className="rounded-md border border-stone-200 bg-white">
      <div className="flex flex-col gap-4 border-b border-stone-200 p-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-lg font-semibold text-stone-900">VAT Return</p>
          <p className="font-display text-xl font-bold text-stone-900">HM Revenue &amp; Customs (VAT)</p>
          <p className="mt-3 text-base text-stone-700">
            {detail.client?.business_name || "Client"}
            {detail.settings?.vat_registration_number ? ` (VAT registration # ${detail.settings.vat_registration_number})` : ""}
          </p>
          <p className="mt-1 text-base text-stone-700">{formatDate(detail.period?.start_date)} - {formatDate(detail.period?.end_date)}</p>
        </div>
        <div className="flex flex-col items-start gap-2 lg:items-end">
          <Badge className={status === "submitted" ? "bg-stone-200 text-stone-700" : "bg-emerald-100 text-emerald-800"}>
            {status === "submitted" ? "Submitted" : "Open"}
          </Badge>
          <p className="text-sm capitalize text-stone-600">{detail.settings?.vat_scheme || "standard"} VAT accounting</p>
          {vatReturn.submitted_at ? <p className="text-sm text-stone-600">Submission date: {formatDateTime(vatReturn.submitted_at)}</p> : null}
          <div className="mt-1 flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Print</Button>
            {status === "open" ? (
              <Button type="button" size="sm" disabled={busy} onClick={onSubmit} style={{ background: "var(--brand)" }}>
                Submit VAT return
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      <div className="grid gap-2 bg-stone-100/80 p-4">
        {(detail.boxes || []).map((box) => (
          <React.Fragment key={box.number}>
            <button
              type="button"
              onClick={() => setOpenBox((current) => current === box.number ? null : box.number)}
              className={`grid w-full grid-cols-1 items-center gap-4 rounded-lg border px-4 py-3 text-left shadow-sm transition sm:grid-cols-[1fr_auto] ${
                openBox === box.number
                  ? "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-100"
                  : [3, 5].includes(box.number)
                    ? "border-blue-200 bg-blue-50/70 hover:border-blue-300 hover:bg-blue-50"
                    : "border-stone-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/30"
              }`}
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className={`inline-flex h-9 min-w-16 shrink-0 items-center justify-center rounded-md px-2 text-xs font-bold ${
                  [3, 5].includes(box.number) ? "bg-blue-100 text-blue-800" : "bg-stone-100 text-stone-700"
                }`}>
                  Box {box.number}
                </span>
                <span>
                  <span className="block text-sm font-medium text-stone-900">{box.label}</span>
                  <span className="mt-0.5 block text-xs text-stone-500">
                    {box.transaction_count || 0} contributing {Number(box.transaction_count || 0) === 1 ? "transaction" : "transactions"}
                    {[3, 5].includes(box.number) ? " · Calculated total" : ""}
                  </span>
                </span>
              </span>
              <span className="flex items-center gap-3">
                <span className={`min-w-28 rounded-md px-3 py-2 text-right font-display text-base font-bold ${
                  [3, 5].includes(box.number) ? "bg-blue-100 text-blue-800" : "bg-stone-100 text-stone-900"
                }`}>
                  {formatMoney(box.value)}
                </span>
                <ArrowRight className={`h-4 w-4 text-stone-500 transition-transform ${openBox === box.number ? "rotate-90 text-emerald-700" : ""}`} />
              </span>
            </button>
            {openBox === box.number ? (
              <VatPeriodBoxDrilldown clientId={clientId} periodId={period.id} box={box} />
            ) : null}
          </React.Fragment>
        ))}
      </div>
      {status === "submitted" ? (
        <div className="border-t border-stone-200 bg-stone-50 px-5 py-3 text-sm text-stone-600">
          This return is read-only. Corrections must be included in the current open VAT period.
        </div>
      ) : null}
    </div>
  );
}

function VatPeriodBoxDrilldown({ clientId, periodId, box }) {
  const [data, setData] = useState(() => normalisePaginatedResponse({ page_size: DEFAULT_PAGE_SIZE }));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (search) params.set("search", search);
    setLoading(true);
    setError("");
    api.get(`/admin/accounting/clients/${clientId}/vat/periods/${periodId}/boxes/${box.number}?${params.toString()}`)
      .then(({ data: response }) => {
        if (!cancelled) setData(normalisePaginatedResponse(response, pageSize));
      })
      .catch((requestError) => {
        if (!cancelled) setError(formatApiError(requestError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [box.number, clientId, page, pageSize, periodId, search]);

  useEffect(() => {
    setPage(1);
  }, [pageSize, search]);

  const exportRows = () => {
    if (!data.rows.length) return;
    const csv = [
      "Date,Document,Type,Source,VAT code,Net,VAT,Box amount",
      ...data.rows.map((row) => [
        row.date,
        row.document_number,
        row.document_type,
        row.source_module,
        row.vat_code,
        row.net,
        row.vat,
        row.box_amount,
      ].map((value) => `"${String(value || "").replaceAll('"', '""')}"`).join(",")),
    ].join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = `vat-return-box-${box.number}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="rounded-lg border border-emerald-200 bg-white p-4 shadow-inner">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold text-stone-900">Box {box.number} detail</p>
          <p className="text-xs text-stone-500">Transactions contributing to this VAT return box.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search transactions" className="h-9 w-56 bg-white" />
          <Button type="button" size="sm" variant="outline" disabled={!data.rows.length} onClick={exportRows}><Download className="mr-2 h-4 w-4" />Export page</Button>
        </div>
      </div>
      {error ? <p className="py-6 text-center text-sm text-red-700">{error}</p> : null}
      {!error && loading && !data.rows.length ? <p className="py-6 text-center text-sm text-stone-500">Loading box transactions...</p> : null}
      {!error && !loading && !data.rows.length ? <p className="py-6 text-center text-sm text-stone-500">No transactions contribute to this box.</p> : null}
      {data.rows.length ? (
        <div className="overflow-auto rounded-md border border-stone-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Document</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">VAT code</th>
                <th className="px-3 py-2 text-right">Net</th>
                <th className="px-3 py-2 text-right">VAT</th>
                <th className="px-3 py-2 text-right">Box amount</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={`${row.id}-${row.box_number}`} className="border-t border-stone-100">
                  <td className="px-3 py-2">{formatDate(row.date)}</td>
                  <td className="px-3 py-2 font-semibold text-stone-900">{row.document_number || "-"}</td>
                  <td className="px-3 py-2">{row.document_type || "-"}</td>
                  <td className="px-3 py-2">{row.source_module || "-"}</td>
                  <td className="px-3 py-2">{row.vat_code || "-"}</td>
                  <td className="px-3 py-2 text-right">{formatMoney(row.net)}</td>
                  <td className="px-3 py-2 text-right">{formatMoney(row.vat)}</td>
                  <td className="px-3 py-2 text-right font-semibold">{formatMoney(row.box_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <PaginationFooter page={data.page} pageSize={data.page_size} totalRows={data.total_rows} totalPages={data.total_pages} onPageChange={setPage} onPageSizeChange={setPageSize} disabled={loading} />
        </div>
      ) : null}
    </div>
  );
}

function VatSelect({ label, value, onChange, options = [], disabled = false }) {
  const normalised = options.map((option) => typeof option === "string" ? { value: option, label: option } : option);
  return (
    <div>
      <Label className="text-xs font-semibold text-stone-600">{label}</Label>
      <select disabled={disabled} value={value || ""} onChange={(e) => onChange(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-500">
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

const YEAR_END_STANDARD_FORMATS = {
  FRS_105: ["micro"],
  FRS_102_1A: ["small_full"],
  FRS_102: ["small_full", "full"],
  IFRS: ["full"],
};

const YEAR_END_FORMAT_LABELS = {
  micro: "Micro-entity",
  small_full: "Small full",
  full: "Full accounts",
  dormant: "Dormant",
};

function normaliseYearEndSelection(current, changes) {
  const next = { ...current, ...changes };
  if (next.company_trading_status === "dormant") {
    next.accounts_format = "dormant";
    if (next.accounts_standard === "IFRS") next.accounts_standard = "FRS_102_1A";
    return next;
  }
  const allowed = YEAR_END_STANDARD_FORMATS[next.accounts_standard] || ["small_full"];
  if (next.accounts_format === "dormant" || !allowed.includes(next.accounts_format)) {
    next.accounts_format = allowed[0];
  }
  return next;
}

function YearEndAccountsWorkspace({ workspace, tab }) {
  const initialData = useMemo(() => workspace?.year_end_accounts || {}, [workspace?.year_end_accounts]);
  const [data, setData] = useState(initialData);
  const [saving, setSaving] = useState(false);
  const years = Array.isArray(workspace?.financial_years) ? workspace.financial_years : [];
  const clientId = workspace?.client?.id;
  const [packForm, setPackForm] = useState({
    financial_year_id: years[0]?.id || "",
    period_from: "",
    period_to: "",
    accounts_standard: "FRS_102_1A",
    accounts_format: "small_full",
    filing_output: "full_accounts",
    company_trading_status: "trading",
  });
  const toSettingsForm = (source, sourceData = {}) => ({
    ...(source || {}),
    responsible_staff_member: source?.responsible_staff_member || sourceData.current_accountant?.name || "",
    director_signing_name: source?.director_signing_name || sourceData.directors?.[0]?.name || "",
    employee_count: source?.details?.employee_count ?? "",
    accounts_taxonomy: source?.details?.accounts_taxonomy || "",
    computations_taxonomy: source?.details?.computations_taxonomy || "",
  });
  const [settingsForm, setSettingsForm] = useState(toSettingsForm(initialData.active_pack, initialData));
  const flattenCt600Fields = (sourceData = {}) => Object.fromEntries(
    (sourceData.hmrc?.ct600_form?.sections || []).flatMap((section) =>
      (section.fields || []).map((field) => [field.box, field.value])
    )
  );
  const flattenCompaniesHouseSections = (sourceData = {}) => Object.fromEntries(
    (sourceData.companies_house?.section_options || []).map((section) => [section.id, section.enabled])
  );
  const customCompaniesHouseSections = (sourceData = {}) => (
    Array.isArray(sourceData.companies_house?.custom_sections)
      ? sourceData.companies_house.custom_sections.map((section) => ({ ...section }))
      : []
  );
  const [ct600Fields, setCt600Fields] = useState(flattenCt600Fields(initialData));
  const flattenSaFields = (sourceData = {}) => Object.fromEntries(
    [
      ...Object.entries(sourceData.hmrc?.self_assessment_form?.saved_values || {}),
      ...(sourceData.hmrc?.self_assessment_form?.sections || []).flatMap((section) =>
        (section.fields || []).map((field) => [field.key, field.value])
      ),
      ...(sourceData.hmrc?.self_assessment_form?.supplementary_forms || []).flatMap((supplementary) =>
        (supplementary.fields || []).map((field) => [field.key, field.value])
      ),
    ]
  );
  const [saFields, setSaFields] = useState(flattenSaFields(initialData));
  const [ct600AutoFields, setCt600AutoFields] = useState(initialData.hmrc?.auto_values || {});
  const [companiesHouseSections, setCompaniesHouseSections] = useState(flattenCompaniesHouseSections(initialData));
  const [companiesHouseCustomSections, setCompaniesHouseCustomSections] = useState(customCompaniesHouseSections(initialData));

  useEffect(() => {
    setData(initialData);
    setSettingsForm(toSettingsForm(initialData.active_pack, initialData));
    setCt600Fields(flattenCt600Fields(initialData));
    setCt600AutoFields(initialData.hmrc?.auto_values || {});
    setSaFields(flattenSaFields(initialData));
    setCompaniesHouseSections(flattenCompaniesHouseSections(initialData));
    setCompaniesHouseCustomSections(customCompaniesHouseSections(initialData));
  }, [initialData]);

  async function reload(packId = data.active_pack?.id) {
    const { data: response } = await api.get(`/admin/accounting/clients/${clientId}/year-end-accounts/workspace`, { params: packId ? { pack_id: packId } : {} });
    setData(response || {});
    setSettingsForm(toSettingsForm(response?.active_pack, response));
    setCt600Fields(flattenCt600Fields(response));
    setCt600AutoFields(response?.hmrc?.auto_values || {});
    setSaFields(flattenSaFields(response));
    setCompaniesHouseSections(flattenCompaniesHouseSections(response));
    setCompaniesHouseCustomSections(customCompaniesHouseSections(response));
  }

  async function run(label, request) {
    setSaving(true);
    try {
      await request();
      toast.success(label);
      await reload();
    } catch (error) {
      toast.error(formatApiError(error));
    } finally {
      setSaving(false);
    }
  }

  function createPack(event) {
    event.preventDefault();
    return run("Year End Accounts pack created", () => api.post(`/admin/accounting/clients/${clientId}/year-end-accounts/packs`, packForm));
  }

  function savePack(event) {
    event.preventDefault();
    if (!data.active_pack?.id) return;
    return run("Accounts preparation settings saved", () => api.put(`/admin/accounting/clients/${clientId}/year-end-accounts/packs/${data.active_pack.id}`, settingsForm));
  }

  function saveCt600Form() {
    if (!data.active_pack?.id) return;
    const overrides = Object.fromEntries(
      Object.entries(ct600Fields).filter(([box, value]) => String(value ?? "") !== String(ct600AutoFields[box] ?? ""))
    );
    return run(
      "CT600 form options saved",
      () => api.put(`/admin/accounting/clients/${clientId}/year-end-accounts/packs/${data.active_pack.id}`, { ct600_fields: overrides })
    );
  }

  function refreshCt600Form() {
    if (!data.active_pack?.id) return;
    const overrides = Object.fromEntries(
      Object.entries(ct600Fields).filter(([box, value]) => String(value ?? "") !== String(ct600AutoFields[box] ?? ""))
    );
    return run(
      "CT600 recalculated from the latest accounts data",
      () => api.put(`/admin/accounting/clients/${clientId}/year-end-accounts/packs/${data.active_pack.id}`, { ct600_fields: overrides })
    );
  }

  function resetCt600Form() {
    if (!data.active_pack?.id || !window.confirm("Reset all CT600 manual changes to the latest automatically populated values?")) return;
    return run(
      "CT600 reset to automatically populated values",
      () => api.put(`/admin/accounting/clients/${clientId}/year-end-accounts/packs/${data.active_pack.id}`, { reset_ct600_fields: true })
    );
  }

  function saveSelfAssessmentForm() {
    if (!data.active_pack?.id) return;
    const automatic = data.hmrc?.self_assessment_form?.auto_values || {};
    const overrides = Object.fromEntries(
      Object.entries(saFields).filter(([key, value]) => String(value ?? "") !== String(automatic[key] ?? ""))
    );
    return run(
      "Self Assessment details saved",
      () => api.put(`/admin/accounting/clients/${clientId}/year-end-accounts/packs/${data.active_pack.id}`, { self_assessment_fields: overrides })
    );
  }

  function saveSelfAssessmentSelection(nextFields) {
    if (!data.active_pack?.id) return;
    const automatic = data.hmrc?.self_assessment_form?.auto_values || {};
    const overrides = Object.fromEntries(
      Object.entries(nextFields).filter(([key, value]) => String(value ?? "") !== String(automatic[key] ?? ""))
    );
    return run(
      "Supplementary form selection saved",
      () => api.put(`/admin/accounting/clients/${clientId}/year-end-accounts/packs/${data.active_pack.id}`, { self_assessment_fields: overrides })
    );
  }

  function resetSelfAssessmentForm() {
    if (!data.active_pack?.id || !window.confirm("Reset manual Self Assessment entries to the latest automatically populated values?")) return;
    return run(
      "Self Assessment reset to automatic values",
      () => api.put(`/admin/accounting/clients/${clientId}/year-end-accounts/packs/${data.active_pack.id}`, { reset_self_assessment_fields: true })
    );
  }

  function saveCompaniesHouseSections() {
    if (!data.active_pack?.id) return;
    return run(
      "Companies House report sections saved",
      () => api.put(`/admin/accounting/clients/${clientId}/year-end-accounts/packs/${data.active_pack.id}`, {
        companies_house_sections: companiesHouseSections,
        companies_house_custom_sections: companiesHouseCustomSections,
      })
    );
  }

  function snapshotPack() {
    if (!data.active_pack?.id) return;
    return run("Trial Balance snapshot created", () => api.post(`/admin/accounting/clients/${clientId}/year-end-accounts/packs/${data.active_pack.id}/snapshot`));
  }

  function packAction(action, label) {
    if (!data.active_pack?.id) return;
    return run(label, () => api.post(`/admin/accounting/clients/${clientId}/year-end-accounts/packs/${data.active_pack.id}/action`, { action }));
  }

  function toggleApproval() {
    if (!pack) return;
    if (pack.status === "approved") {
      const confirmed = window.confirm(
        "Unapproving will unlock the accounts and create a new editable version. Any later generated filing package must be regenerated. Continue?"
      );
      if (!confirmed) return;
      return packAction("reopen", "Accounts unapproved and reopened as a new version");
    }
    return packAction("approve", "Accounts approved and locked");
  }

  function generatePreviewPackage() {
    if (!pack?.id) return;
    return run(
      "Draft CT600, computation and iXBRL review artefacts generated",
      () => api.post(`/admin/accounting/clients/${clientId}/year-end-accounts/packs/${pack.id}/generate-preview`)
    );
  }

  async function downloadGeneratedOutput(output) {
    setSaving(true);
    try {
      const response = await api.get(
        `/admin/accounting/clients/${clientId}/year-end-accounts/outputs/${output.id}/download`,
        { responseType: "blob" }
      );
      const url = window.URL.createObjectURL(response.data);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = output.metadata?.filename || `year-end-preview-${output.id}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(formatApiError(error));
    } finally {
      setSaving(false);
    }
  }

  async function downloadFillableCt600() {
    if (!pack?.id) return;
    setSaving(true);
    try {
      const response = await api.get(`/admin/accounting/clients/${clientId}/year-end-accounts/packs/${pack.id}/ct600.pdf`, { responseType: "blob" });
      const url = window.URL.createObjectURL(response.data);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${String(data.companies_house?.accounts_preview?.title || "company").replace(/[^a-z0-9]+/gi, "-")}-CT600-2026-fillable.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(formatApiError(error));
    } finally {
      setSaving(false);
    }
  }

  async function downloadSelfAssessmentForm(formCode) {
    if (!pack?.id || !formCode) return;
    setSaving(true);
    try {
      const code = `${String(formCode).toUpperCase().replace(/-2026$/, "")}-2026`;
      const response = await api.get(
        `/admin/accounting/clients/${clientId}/year-end-accounts/packs/${pack.id}/self-assessment/${code}.pdf`,
        { responseType: "blob" }
      );
      const url = window.URL.createObjectURL(response.data);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${String(data.companies_house?.accounts_preview?.title || "taxpayer").replace(/[^a-z0-9]+/gi, "-")}-${code}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(formatApiError(error));
    } finally {
      setSaving(false);
    }
  }

  async function deleteGeneratedOutput(output) {
    if (!window.confirm(`Delete ${output.metadata?.filename || "this generated draft"}?`)) return;
    return run(
      "Generated draft deleted",
      () => api.delete(`/admin/accounting/clients/${clientId}/year-end-accounts/outputs/${output.id}`)
    );
  }

  async function clearGeneratedOutputs() {
    if (!pack?.id || !window.confirm("Delete all generated draft accounts, CT600 and validation artefacts for this accounts pack?")) return;
    return run(
      "All generated drafts cleared",
      () => api.delete(`/admin/accounting/clients/${clientId}/year-end-accounts/packs/${pack.id}/outputs`)
    );
  }

  const readiness = data.readiness || {};
  const statements = data.accounts_preview || {};
  const pack = data.active_pack;
  const postingCoverage = data.posting_coverage || {};
  const directors = data.directors || [];
  const auditBasisOptions = data.audit_basis_options || [];
  const taxonomy = data.taxonomy || {};
  const taxonomySelection = taxonomy.selection || {};
  const compliance = data.compliance || {};
  const destination = tab === "HMRC" ? data.hmrc : tab === "Companies House" ? data.companies_house : null;
  const liveCompaniesHousePreview = data.companies_house ? {
    ...(data.companies_house.accounts_preview || {}),
    section_options: (data.companies_house.section_options || []).map((section) => ({
      ...section,
      enabled: section.required || !!companiesHouseSections[section.id],
    })),
    custom_sections: companiesHouseCustomSections,
  } : {};

  if (tab === "Overview") {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <SummaryCard label="Accounts period" value={data.period?.label || "Not configured"} tone="blue" />
          <SummaryCard label="Trial balance" value={readiness.trial_balance || "Review"} tone={readiness.trial_balance === "Ready" ? "emerald" : "amber"} />
          <SummaryCard label="HMRC package" value={readiness.hmrc || "Blocked"} tone={readiness.hmrc === "Ready" ? "emerald" : "amber"} />
          <SummaryCard label="Companies House" value={readiness.companies_house || "Blocked"} tone={readiness.companies_house === "Ready" ? "emerald" : "amber"} />
          <SummaryCard label="Overall" value={readiness.overall || "Review"} tone={readiness.overall === "Ready" ? "emerald" : "amber"} />
          <SummaryCard label="Posted journals in period" value={`${postingCoverage.posted_in_period || 0} / ${postingCoverage.total_posted || 0}`} tone={postingCoverage.posted_in_period ? "emerald" : "amber"} />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Authoritative filing baseline">
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <div className="font-bold">Production filing is disabled</div>
              <p className="mt-1">The current editors and previews are prototypes. They are not compliant filing artefacts until every official validation and destination-test gate passes.</p>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <Info label="HMRC specification" value={compliance.hmrc?.release || "Not installed"} />
              <Info label="HMRC artefact integrity" value={compliance.hmrc?.integrity_verified ? "Verified" : "Not verified"} />
              <Info label="Companies House specification" value={compliance.companies_house?.release || "Not installed"} />
              <Info label="Companies House TIS" value={compliance.companies_house?.specification_present ? "Installed" : "Not installed"} />
            </div>
          </Panel>
          <Panel title={pack ? "Active accounts pack" : "Create accounts pack"}>
            {pack ? (
              <div className="space-y-3">
                {(data.packs || []).length > 1 ? (
                  <div>
                    <Label className="text-xs">Active preparation pack</Label>
                    <select value={pack.id} onChange={(event) => reload(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-stone-200 bg-white px-3 text-sm">
                      {(data.packs || []).map((option) => <option key={option.id} value={option.id}>{option.period_from} to {option.period_to} · {option.status} · v{option.version_number || 1}</option>)}
                    </select>
                  </div>
                ) : null}
                <div className="grid gap-2 md:grid-cols-2">
                  <Info label="Period" value={`${pack.period_from} to ${pack.period_to}`} />
                  <Info label="Version" value={pack.version_number || 1} />
                  <Info label="Standard" value={pack.accounts_standard} />
                  <Info label="Format" value={pack.accounts_format} />
                  <Info label="Status" value={pack.status} />
                  <Info label="Snapshot" value={pack.contents?.snapshot_hash ? `${String(pack.contents.snapshot_hash).slice(0, 12)}…` : "Not created"} />
                  <Info label="Available posted data" value={postingCoverage.first_posted_date ? `${formatDate(postingCoverage.first_posted_date)} to ${formatDate(postingCoverage.last_posted_date)}` : "No posted journals"} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={snapshotPack} disabled={saving || pack.locked_snapshot}><RefreshCw className="mr-2 h-4 w-4" />Create / refresh snapshot</Button>
                  <Button type="button" variant="outline" onClick={() => packAction("submit_for_review", "Accounts submitted for review")} disabled={saving || !pack.contents?.snapshot_id || pack.status === "approved"}>Submit for review</Button>
                  <Button type="button" variant="outline" onClick={toggleApproval} disabled={saving || !["in_review", "approved"].includes(pack.status)}>
                    {pack.status === "approved" ? "Unapprove accounts" : "Approve accounts"}
                  </Button>
                </div>
                <p className="text-xs text-stone-500">Refreshing takes a versioned copy of the canonical Trial Balance and its Chart of Accounts mappings. Approval locks that snapshot.</p>
              </div>
            ) : (
              <form className="space-y-3" onSubmit={createPack}>
                <div className="grid gap-3 md:grid-cols-2">
                  {years.length ? <div><Label className="text-xs">Financial year</Label><select value={packForm.financial_year_id} onChange={(event) => setPackForm((current) => ({ ...current, financial_year_id: event.target.value }))} className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm">{years.map((year) => <option key={year.id} value={year.id}>{year.name || `${formatDate(year.start_date)} - ${formatDate(year.end_date)}`}</option>)}</select></div> : <><Field label="Accounts period start" type="date" value={packForm.period_from} onChange={(value) => setPackForm((current) => ({ ...current, period_from: value }))} /><Field label="Accounts period end" type="date" value={packForm.period_to} onChange={(value) => setPackForm((current) => ({ ...current, period_to: value }))} /></>}
                  <div><Label className="text-xs">Accounting standard</Label><select value={packForm.accounts_standard} onChange={(event) => setPackForm((current) => normaliseYearEndSelection(current, { accounts_standard: event.target.value }))} className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm"><option value="FRS_105">FRS 105 - Micro-entities</option><option value="FRS_102_1A">FRS 102 Section 1A - Small entities</option><option value="FRS_102">FRS 102 - Full</option><option value="IFRS">UK-adopted IFRS</option></select></div>
                  <div><Label className="text-xs">Accounts format</Label><select value={packForm.accounts_format} onChange={(event) => setPackForm((current) => normaliseYearEndSelection(current, { accounts_format: event.target.value }))} className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm">{(packForm.company_trading_status === "dormant" ? ["dormant"] : YEAR_END_STANDARD_FORMATS[packForm.accounts_standard] || []).map((value) => <option key={value} value={value}>{YEAR_END_FORMAT_LABELS[value]}</option>)}</select></div>
                  <div><Label className="text-xs">Trading status</Label><select value={packForm.company_trading_status} onChange={(event) => setPackForm((current) => normaliseYearEndSelection(current, { company_trading_status: event.target.value }))} className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm"><option value="trading">Trading</option><option value="dormant">Dormant</option><option value="non_trading">Non-trading</option></select></div>
                </div>
                <Button disabled={saving || (!packForm.financial_year_id && !(packForm.period_from && packForm.period_to))}>Create preparation pack</Button>
              </form>
            )}
          </Panel>
          <Panel title="Preparation workflow">
            <ReportTable rows={data.workflow || []} columns={[["step", "Step"], ["purpose", "Purpose"], ["status", "Status"]]} empty="No preparation workflow available." compact />
          </Panel>
          <Panel title="Compliance blockers">
            <ComplianceIssues issues={data.blockers || []} empty="No current blockers." />
          </Panel>
        </div>
      </div>
    );
  }

  if (tab === "Accounts Preview") {
    const trialBalance = Array.isArray(data.trial_balance) ? data.trial_balance : [];
    const trialBalanceSummary = data.trial_balance_summary || {};
    return (
      <div className="space-y-4">
        <Panel title="Trial Balance">
          <ReportTable
            rows={trialBalance}
            columns={[["code", "Code"], ["name", "Account"], ["statement", "Statement"], ["debit", "Debit", "money"], ["credit", "Credit", "money"], ["filing_status", "Status"]]}
            empty="No Trial Balance balances are available for this accounts period."
            compact
          />
          {trialBalance.length ? (
            <div className="flex flex-wrap justify-end gap-x-8 gap-y-2 border-t border-stone-200 bg-stone-50 px-3 py-2 text-sm font-semibold text-stone-700">
              <span>Total debit: {formatMoney(trialBalanceSummary.debit_total)}</span>
              <span>Total credit: {formatMoney(trialBalanceSummary.credit_total)}</span>
              <span className={Number(trialBalanceSummary.difference || 0) === 0 ? "text-emerald-700" : "text-red-700"}>Difference: {formatMoney(trialBalanceSummary.difference)}</span>
            </div>
          ) : null}
        </Panel>
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Profit and loss preview"><ReportTable rows={statements.profit_and_loss?.rows || []} columns={[["label", "Line"], ["amount", "Current", "money"], ["comparative", "Comparative", "money"]]} empty="No mapped profit and loss lines." compact /></Panel>
          <Panel title="Balance sheet preview"><ReportTable rows={statements.balance_sheet?.rows || []} columns={[["label", "Line"], ["amount", "Current", "money"], ["comparative", "Comparative", "money"]]} empty="No mapped balance sheet lines." compact /></Panel>
        </div>
        <Panel title="Disclosure and mapping review"><ComplianceIssues issues={statements.validation || []} empty="No disclosure or mapping exceptions." /></Panel>
        <div className="flex justify-end"><Button type="button" onClick={snapshotPack} disabled={saving || !pack || pack.locked_snapshot}><RefreshCw className="mr-2 h-4 w-4" />Refresh preview from Trial Balance</Button></div>
      </div>
    );
  }

  if (destination) {
    return (
      <div className="space-y-4">
        {tab === "HMRC" ? (
          destination.workflow_enabled ? <>
            {destination.workflow_profile === "sole_trader" ? (
              <SelfAssessmentEditor clientId={clientId} packId={pack?.id} form={destination.self_assessment_form} values={saFields} setValues={setSaFields} onSave={saveSelfAssessmentForm} onReset={resetSelfAssessmentForm} onSupplementaryChange={saveSelfAssessmentSelection} onDownload={downloadSelfAssessmentForm} downloadDisabled={saving || !pack} disabled={saving || pack?.locked_snapshot} />
            ) : <>
              <Panel title="HMRC return type">
                <div className="flex flex-wrap gap-2">
                  {(destination.forms || []).map((form) => (
                    <Button key={form.id} type="button" variant={form.id === destination.selected_form ? "default" : "outline"} disabled={form.id !== "ct600"}>
                      {form.label}{form.status !== "Available" ? ` - ${form.status}` : ""}
                    </Button>
                  ))}
                </div>
                <p className="mt-3 text-sm text-stone-600">The standard CT600 workflow is enabled from the Limited company selection in Client Settings. Specialist supplementary returns remain deferred until their eligibility rules are implemented.</p>
              </Panel>
              <Ct600FormEditor form={destination.ct600_form} editorSections={destination.editor_sections || []} visibleBoxes={destination.visible_boxes || []} automaticBoxes={destination.auto_boxes || []} values={ct600Fields} setValues={setCt600Fields} onSave={saveCt600Form} disabled={saving || pack?.locked_snapshot} />
              <div className="flex justify-end"><Button type="button" variant="outline" onClick={downloadFillableCt600} disabled={saving || !pack}>Download populated fillable CT600 PDF</Button></div>
              <Panel title="CT600 completion map"><ReportTable rows={destination.ct600_sections || []} columns={[["section", "Section"], ["boxes", "Boxes"], ["status", "Status"]]} compact /></Panel>
            </>}
          </> : (
            <Panel title="CT600 workflow not enabled">
              <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                Select <strong>Limited company</strong> as the client type in Client Settings to enable the standard CT600 workflow. Other entity types will be introduced with their own filing rules later.
              </div>
            </Panel>
          )
        ) : (
          <div className="grid items-start gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
            <aside className="min-w-0 xl:sticky xl:top-4 xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto xl:pr-1">
              <CompaniesHouseSectionOptions
                sections={destination.section_options || []}
                values={companiesHouseSections}
                setValues={setCompaniesHouseSections}
                customSections={companiesHouseCustomSections}
                setCustomSections={setCompaniesHouseCustomSections}
                onSave={saveCompaniesHouseSections}
                disabled={saving || pack?.locked_snapshot}
                compact
              />
            </aside>
            <main className="min-w-0">
              <CompaniesHouseAccountsPages preview={liveCompaniesHousePreview} />
            </main>
          </div>
        )}
      </div>
    );
  }

  if (tab === "iXBRL & Validation") {
    return (
      <div className="space-y-4">
        <Panel title="Mandatory production release gates">
          <ReportTable rows={compliance.release_gates || []} columns={[["label", "Requirement"], ["status", "Status"]]} empty="Compliance specification registry is unavailable." compact />
        </Panel>
        <Panel title="Versioned taxonomy and validation pipeline">
          <ReportTable rows={data.ixbrl?.pipeline || []} columns={[["stage", "Stage"], ["requirement", "Requirement"], ["status", "Status"]]} compact />
        </Panel>
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="font-bold">Draft generation and final filing are separate stages</div>
          <p className="mt-1">You can generate review artefacts once the Trial Balance snapshot and both period-valid taxonomy selections are saved. These drafts are not submission-ready until external schema, calculation, dimension and destination validation pass.</p>
          <Button className="mt-3" type="button" onClick={generatePreviewPackage} disabled={saving || !data.ixbrl?.can_generate_preview}>Generate draft review package</Button>
        </div>
        <Panel title="Generated review artefacts">
          {(data.ixbrl?.outputs || []).length ? (
            <div className="space-y-2">
              <div className="flex justify-end"><Button type="button" variant="outline" onClick={clearGeneratedOutputs} disabled={saving}>Delete all generated drafts</Button></div>
              {(data.ixbrl.outputs || []).map((output) => (
                <div key={output.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-stone-200 p-3 text-sm">
                  <div>
                    <div className="font-semibold text-stone-900">{output.metadata?.filename || output.output_type}</div>
                    <div className="text-xs text-stone-500">{output.format} · {output.status} · External validation: {output.validation?.submission_ready ? "Passed" : "Pending"}</div>
                  </div>
                  <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => downloadGeneratedOutput(output)} disabled={saving}>Download draft</Button><Button type="button" variant="outline" onClick={() => deleteGeneratedOutput(output)} disabled={saving}>Delete</Button></div>
                </div>
              ))}
            </div>
          ) : <p className="py-6 text-center text-sm text-stone-500">No draft review artefacts generated yet.</p>}
        </Panel>
      </div>
    );
  }

  if (tab === "Submissions") {
    return (
      <div className="space-y-4">
        <Panel title="Submission history"><ReportTable rows={data.submissions || []} columns={[["destination", "Destination"], ["status", "Status"], ["created_at", "Created"], ["receipt_reference", "Receipt"]]} empty="No filing package has been submitted." compact /></Panel>
        <div className="rounded-md border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700">Submission actions will become available only after package approval, credential checks, test-service validation, and an immutable filing snapshot.</div>
      </div>
    );
  }

  return (
    <Panel title="Year End Accounts settings">
      {!pack ? <p className="py-8 text-center text-sm text-stone-500">Create an accounts pack from Overview before configuring it.</p> : (
        <form className="space-y-4" onSubmit={savePack}>
          {postingCoverage.total_posted && !postingCoverage.posted_in_period ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="font-semibold">The accounts period excludes all posted Trial Balance data.</div>
              <p className="mt-1">Posted journals run from {formatDate(postingCoverage.first_posted_date)} to {formatDate(postingCoverage.last_posted_date)}. Confirm the legal accounts period before changing it.</p>
              <Button type="button" variant="outline" className="mt-2" onClick={() => setSettingsForm((current) => ({ ...current, period_from: postingCoverage.first_posted_date, period_to: postingCoverage.last_posted_date }))}>Copy available posting dates</Button>
            </div>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Field label="Accounts period start" type="date" value={settingsForm.period_from || ""} disabled={pack.locked_snapshot} onChange={(value) => setSettingsForm((current) => ({ ...current, period_from: value }))} />
            <Field label="Accounts period end" type="date" value={settingsForm.period_to || ""} disabled={pack.locked_snapshot} onChange={(value) => setSettingsForm((current) => ({ ...current, period_to: value }))} />
            <Field label="Comparative period start" type="date" value={settingsForm.comparative_period_from || ""} disabled={pack.locked_snapshot} onChange={(value) => setSettingsForm((current) => ({ ...current, comparative_period_from: value }))} />
            <Field label="Comparative period end" type="date" value={settingsForm.comparative_period_to || ""} disabled={pack.locked_snapshot} onChange={(value) => setSettingsForm((current) => ({ ...current, comparative_period_to: value }))} />
            <div><Label className="text-xs">Accounting standard</Label><select value={settingsForm.accounts_standard || ""} disabled={pack.locked_snapshot} onChange={(event) => setSettingsForm((current) => normaliseYearEndSelection(current, { accounts_standard: event.target.value }))} className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm"><option value="FRS_105">FRS 105</option><option value="FRS_102_1A">FRS 102 Section 1A</option><option value="FRS_102">FRS 102</option><option value="IFRS">UK-adopted IFRS</option></select></div>
            <div><Label className="text-xs">Accounts format</Label><select value={settingsForm.accounts_format || ""} disabled={pack.locked_snapshot} onChange={(event) => setSettingsForm((current) => normaliseYearEndSelection(current, { accounts_format: event.target.value }))} className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm">{(settingsForm.company_trading_status === "dormant" ? ["dormant"] : YEAR_END_STANDARD_FORMATS[settingsForm.accounts_standard] || []).map((value) => <option key={value} value={value}>{YEAR_END_FORMAT_LABELS[value]}</option>)}</select></div>
            <div><Label className="text-xs">Trading status</Label><select value={settingsForm.company_trading_status || "trading"} disabled={pack.locked_snapshot} onChange={(event) => setSettingsForm((current) => normaliseYearEndSelection(current, { company_trading_status: event.target.value }))} className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm"><option value="trading">Trading</option><option value="non_trading">Non-trading</option><option value="dormant">Dormant</option></select></div>
            <Field label="Responsible staff member" value={settingsForm.responsible_staff_member || ""} disabled={pack.locked_snapshot} onChange={(value) => setSettingsForm((current) => ({ ...current, responsible_staff_member: value }))} />
            <Field label="Average employee count" type="number" value={settingsForm.employee_count ?? ""} disabled={pack.locked_snapshot} onChange={(value) => setSettingsForm((current) => ({ ...current, employee_count: value }))} />
            <div>
              <Label className="text-xs">Audit exemption / auditor report basis</Label>
              <select value={settingsForm.audit_exemption || ""} disabled={pack.locked_snapshot} onChange={(event) => setSettingsForm((current) => ({ ...current, audit_exemption: event.target.value }))} className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm">
                <option value="">Select basis</option>
                {auditBasisOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">Signing director</Label>
              <select value={settingsForm.director_signing_name || ""} disabled={pack.locked_snapshot} onChange={(event) => setSettingsForm((current) => ({ ...current, director_signing_name: event.target.value }))} className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm">
                <option value="">Select director</option>
                {directors.map((director) => <option key={director.id || director.name} value={director.name}>{director.name} — {director.role || "Director"}</option>)}
              </select>
              {!directors.length ? <p className="mt-1 text-xs text-amber-700">Add a director to the client record before approval.</p> : null}
            </div>
            <Field label="Board approval date" type="date" value={settingsForm.board_approval_date || ""} disabled={pack.locked_snapshot} onChange={(value) => setSettingsForm((current) => ({ ...current, board_approval_date: value }))} />
            <div>
              <Label className="text-xs">FRC accounts taxonomy</Label>
              <select value={settingsForm.accounts_taxonomy || ""} disabled={pack.locked_snapshot} onChange={(event) => setSettingsForm((current) => ({ ...current, accounts_taxonomy: event.target.value }))} className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm">
                <option value="">Select accounts taxonomy</option>
                {(taxonomy.accounts_options || []).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">Corporation Tax computations taxonomy</Label>
              <select value={settingsForm.computations_taxonomy || ""} disabled={pack.locked_snapshot} onChange={(event) => setSettingsForm((current) => ({ ...current, computations_taxonomy: event.target.value }))} className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm">
                <option value="">Select computations taxonomy</option>
                {(taxonomy.computations_options || []).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {["accounts", "computations"].map((kind) => {
              const selection = taxonomySelection[kind] || {};
              return (
                <div key={kind} className={`rounded-md border p-3 text-sm ${selection.hmrc_accepted && selection.period_valid ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
                  <div className="font-semibold">{kind === "accounts" ? "Accounts taxonomy checks" : "Computations taxonomy checks"}</div>
                  <div>Supported by HMRC for electronic filing: {selection.hmrc_accepted ? "Yes" : "No"}</div>
                  <div>Valid for selected period: {selection.period_valid ? "Yes" : "No"}</div>
                </div>
              );
            })}
          </div>
          <Button type="submit" disabled={saving || pack.locked_snapshot}>Save preparation settings</Button>
        </form>
      )}
      <div className="mt-4"><ReportTable rows={data.settings_requirements || []} columns={[["setting", "Setting"], ["value", "Current value"], ["status", "Status"]]} compact /></div>
    </Panel>
  );
}

function ComplianceIssues({ issues = [], empty }) {
  if (!issues.length) return <p className="py-6 text-center text-sm text-stone-500">{empty}</p>;
  return <div className="space-y-2">{issues.map((item, index) => <div key={`${item.code || item}-${index}`} className={`rounded-md border px-3 py-2 text-sm ${item.severity === "blocker" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{item.message || item}</div>)}</div>;
}

function LegacySelfAssessmentEditor({ form, values, setValues, onSave, onReset, disabled }) {
  if (!form) return <Panel title="Self Assessment"><p className="text-sm text-stone-600">Create an active preparation pack to populate the return.</p></Panel>;
  const update = (field, value) => setValues((current) => ({ ...current, [field.key]: value }));
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
        <div className="font-display text-xl font-bold text-emerald-950">{form.form} - Sole trader</div>
        <div className="text-sm text-emerald-800">{form.tax_year} · {form.supplementary_form}</div>
        <p className="mt-2 text-xs text-emerald-800">Grey fields are populated from the client record, accounts period and Trial Balance. Complete the white fields where applicable, then save.</p>
      </div>
      {(form.sections || []).map((section) => (
        <Panel key={section.id} title={section.title}>
          <div className="grid gap-3 md:grid-cols-2">
            {(section.fields || []).map((field) => (
              <label key={field.key} className={field.type === "textarea" ? "md:col-span-2" : ""}>
                <span className="mb-1 block text-xs font-semibold text-stone-700">{field.label}</span>
                {field.type === "boolean" ? (
                  <span className={`flex h-10 items-center gap-3 rounded-md border px-3 text-sm ${field.automatic ? "border-stone-200 bg-stone-100" : "border-stone-300 bg-white"}`}>
                    <input type="checkbox" checked={!!values[field.key]} disabled={disabled || field.automatic} onChange={(event) => update(field, event.target.checked)} />
                    {values[field.key] ? "Yes" : "No"}
                  </span>
                ) : field.type === "textarea" ? (
                  <textarea className={`min-h-24 w-full rounded-md border px-3 py-2 text-sm ${field.automatic ? "bg-stone-100 text-stone-600" : "bg-white"}`} value={values[field.key] ?? ""} disabled={disabled || field.automatic} onChange={(event) => update(field, event.target.value)} />
                ) : (
                  <Input type={field.type === "money" ? "number" : field.type} step={field.type === "money" ? "0.01" : undefined} value={values[field.key] ?? ""} disabled={disabled || field.automatic} className={field.automatic ? "bg-stone-100 text-stone-600" : ""} onChange={(event) => update(field, event.target.value)} />
                )}
                <span className="mt-1 block text-[11px] text-stone-500">{field.automatic ? "Automatically populated" : "Enter only when this applies to the taxpayer"}</span>
              </label>
            ))}
          </div>
        </Panel>
      ))}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onReset} disabled={disabled}>Reset to automatic</Button>
        <Button type="button" onClick={onSave} disabled={disabled}>Save Self Assessment details</Button>
      </div>
    </div>
  );
}

function LegacySelfAssessmentPreview({ form, values }) {
  if (!form) return <Panel title="Self Assessment preview"><p className="text-sm text-stone-600">No return is available yet.</p></Panel>;
  return (
    <div className="mx-auto max-w-[900px] space-y-4">
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Draft human-readable preview. HMRC XML validation and test-service acceptance are still required before filing.</div>
      {(form.sections || []).map((section, sectionIndex) => (
        <section key={section.id} className="min-h-[520px] border border-stone-300 bg-white p-8 shadow-sm">
          <header className="mb-6 flex items-start justify-between border-b-4 border-emerald-700 pb-3">
            <div><div className="text-xs font-bold uppercase tracking-widest text-emerald-800">HM Revenue &amp; Customs</div><h2 className="mt-1 text-2xl font-bold">{form.form}</h2><p className="text-sm text-stone-600">{form.tax_year}</p></div>
            <div className="text-right text-xs text-stone-500">Page {sectionIndex + 1}<br />DRAFT PREVIEW</div>
          </header>
          <h3 className="mb-4 text-lg font-bold">{section.title}</h3>
          <div className="divide-y divide-emerald-100 border border-emerald-200 bg-emerald-50/60">
            {(section.fields || []).map((field, index) => (
              <div key={field.key} className="grid grid-cols-[42px_1fr_220px] items-center gap-3 p-3">
                <span className="bg-emerald-700 px-2 py-1 text-center text-xs font-bold text-white">{index + 1}</span>
                <span className="text-sm font-semibold text-stone-900">{field.label}</span>
                <span className="min-h-8 border border-emerald-300 bg-white px-2 py-1 text-right font-mono text-sm">
                  {field.type === "boolean" ? (values[field.key] ? "X" : "") : (values[field.key] ?? "")}
                </span>
              </div>
            ))}
          </div>
          <footer className="mt-8 flex justify-between border-t border-stone-300 pt-2 text-xs text-stone-500"><span>SA100 2026 working preview</span><span>{section.title}</span></footer>
        </section>
      ))}
    </div>
  );
}

const SA100_SUPPLEMENTARY_PAGES = [
  ["employment", "SA102", "Employment", "For each employment, directorship or office held."],
  ["self_employment", "SA103S / SA103F", "Self-employment", "Required for this sole trader; short or full pages depend on eligibility.", true],
  ["partnership", "SA104S", "Partnership (short)", "For partnership income where the short partnership pages are appropriate."],
  ["uk_property", "SA105", "UK property", "For UK property and relevant property income."],
  ["foreign", "SA106", "Foreign", "For foreign income, gains, foreign tax or relief."],
  ["trusts", "SA107", "Trusts etc.", "For income from trusts, settlements or estates."],
  ["capital_gains", "SA108", "Capital gains", "For reportable disposals, gains, losses or claims."],
  ["residence", "SA109", "Residence / FIG", "For residence, remittance basis and the FIG regime."],
  ["additional_information_pages", "SA101", "Additional information", "For less common income, reliefs and other information."],
  ["tax_calculation_summary", "SA110", "Tax calculation summary", "Generated with the tax calculation to report tax, NICs, student loans and amounts due or overpaid.", true],
];

function SelfAssessmentField({ field, value, disabled, onChange }) {
  const locked = disabled || field.automatic;
  return (
    <label className={field.type === "textarea" ? "md:col-span-2" : ""}>
      <span className="mb-1 block text-xs font-semibold text-stone-700">{field.label}</span>
      {field.type === "boolean" ? (
        <span className={`flex h-10 items-center gap-3 rounded-md border px-3 text-sm ${field.automatic ? "border-stone-200 bg-stone-100" : "border-stone-300 bg-white"}`}>
          <input type="checkbox" checked={!!value} disabled={locked} onChange={(event) => onChange(event.target.checked)} />{value ? "Yes" : "No"}
        </span>
      ) : field.type === "select" ? (
        <select value={value ?? ""} disabled={locked} className={`h-10 w-full rounded-md border px-3 text-sm ${field.automatic ? "bg-stone-100 text-stone-600" : "bg-white"}`} onChange={(event) => onChange(event.target.value)}>
          {(field.options || []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      ) : field.type === "textarea" ? (
        <textarea maxLength={field.max_length} placeholder={field.placeholder} className={`min-h-24 w-full rounded-md border px-3 py-2 text-sm ${field.automatic ? "bg-stone-100 text-stone-600" : "bg-white"}`} value={value ?? ""} disabled={locked} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <Input type={field.type === "money" ? "number" : field.type} step={field.type === "money" ? "0.01" : undefined} maxLength={field.type === "number" || field.type === "money" ? undefined : field.max_length} pattern={field.pattern} placeholder={field.placeholder} value={value ?? ""} disabled={locked} className={field.automatic ? "bg-stone-100 text-stone-600" : ""} onChange={(event) => onChange(event.target.value)} />
      )}
      <span className="mt-1 flex justify-between text-[11px] text-stone-500">
        <span>
          {field.automatic ? "Automatically populated and locked" : "Enter only when this applies"}
          {field.placeholder ? ` · Format: ${field.placeholder}` : ""}
        </span>
        {field.max_length ? <span>{String(value ?? "").length}/{field.max_length} characters</span> : null}
        {field.max_digits ? <span>{String(value ?? "").replace(/\D/g, "").length}/{field.max_digits} digits</span> : null}
      </span>
      {field.mapping_warning ? <span className="mt-1 block text-[11px] font-semibold text-amber-700">{field.mapping_warning}</span> : null}
    </label>
  );
}

function SupplementaryFormEditor({ supplementary, values, setValues, disabled, clientId, packId }) {
  if (supplementary) {
    return (
      <OfficialFormDetails
        title={`${supplementary.code} - ${supplementary.title}`}
        formCode={supplementary.code}
        endpoint={`/admin/accounting/clients/${clientId}/year-end-accounts/packs/${packId}/self-assessment/${supplementary.code}-2026.pdf?read_only=true&editor=true`}
        headerItems={[
          { label: "Your name", value: "Automatically populated from the client record" },
          { label: "Unique Taxpayer Reference", value: "Automatically populated from the client record" },
        ]}
        fields={supplementary.fields || []}
        values={values}
        setValues={setValues}
        disabled={disabled}
        renderField={(field) => (
          <SelfAssessmentField
            field={field}
            value={values[field.key]}
            disabled={disabled}
            onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))}
          />
        )}
        emptyMessage="The official form is installed, but no active numbered boxes could be read from its artwork."
      />
    );
  }
  return (
    <Panel title={`${supplementary.code} — ${supplementary.title}`}>
      <div className="mb-4 grid gap-3 rounded-md border border-[#96d8d6] bg-[#edf8f7] p-3 md:grid-cols-2">
        <div>
          <div className="text-xs font-bold text-stone-700">Your name</div>
          <div className="mt-1 rounded-sm border border-[#78cbc8] bg-stone-100 px-3 py-2 text-sm text-stone-600">Automatically populated from SA100</div>
        </div>
        <div>
          <div className="text-xs font-bold text-stone-700">Unique Taxpayer Reference</div>
          <div className="mt-1 rounded-sm border border-[#78cbc8] bg-stone-100 px-3 py-2 text-sm text-stone-600">Automatically populated from SA100</div>
        </div>
      </div>
      <div className="grid overflow-hidden border border-[#83cfcc] md:grid-cols-2">
        {(supplementary.fields || []).map((field) => (
          <div key={field.key} className="grid grid-cols-[46px_minmax(0,1fr)] gap-3 border-b border-r border-[#a7ddda] bg-[#edf8f7] p-3">
            <span className="h-fit bg-[#009b96] px-1 py-1 text-center text-xs font-bold text-white">{field.box}</span>
            <SelfAssessmentField field={field} value={values[field.key]} disabled={disabled} onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))} />
          </div>
        ))}
      </div>
      {!supplementary.fields?.length ? <p className="py-6 text-center text-sm text-amber-800">The official form is installed, but no active numbered boxes could be read from its artwork.</p> : null}
    </Panel>
  );
}

function SelfAssessmentEditor({ clientId, packId, form, values, setValues, onSave, onReset, onSupplementaryChange, onDownload, downloadDisabled, disabled }) {
  const [activeEditorForm, setActiveEditorForm] = useState("SA100");
  const selectedSupplementaryForms = (form?.supplementary_forms || []).filter((supplementary) => values[supplementary.selection_key]);
  const selfEmploymentCode = values.self_employment ? (values.self_employment_schedule || "SA103S") : "";
  const editorTabs = [
    { code: "SA100", title: "Main tax return" },
    ...(selfEmploymentCode ? [{ code: selfEmploymentCode, title: "Self-employment" }] : []),
    ...selectedSupplementaryForms.map((supplementary) => ({ code: supplementary.code, title: supplementary.title })),
  ];
  const editorTabCodes = editorTabs.map((item) => item.code).join("|");
  useEffect(() => {
    if (!editorTabCodes.split("|").includes(activeEditorForm)) setActiveEditorForm("SA100");
  }, [activeEditorForm, editorTabCodes]);
  if (!form) return <Panel title="Self Assessment"><p className="text-sm text-stone-600">Create an active preparation pack to populate the return.</p></Panel>;
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
        <div className="font-display text-xl font-bold text-emerald-950">{form.form} - Sole trader</div>
        <div className="text-sm text-emerald-800">{form.tax_year} · {form.supplementary_form}</div>
        <p className="mt-2 text-xs text-emerald-800">Grey fields are sourced from the client record, accounting period and Trial Balance. White fields remain editable.</p>
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="xl:sticky xl:top-3">
          <Panel title="Supplementary pages">
            <p className="mb-3 text-xs text-stone-600">Enable every schedule that forms part of the return. Selections appear on official page TR2.</p>
            <div className="space-y-2">
              {SA100_SUPPLEMENTARY_PAGES.map(([key, code, label, help, locked]) => (
                <label key={key} className={`block rounded-md border p-3 ${values[key] ? "border-emerald-300 bg-emerald-50" : "border-stone-200 bg-white"}`}>
                  <span className="flex items-center gap-2">
                    <input type="checkbox" checked={!!values[key]} disabled={disabled || locked} onChange={(event) => {
                      const nextValues = { ...values, [key]: event.target.checked };
                      setValues(nextValues);
                      onSupplementaryChange?.(nextValues);
                    }} />
                    <strong className="text-sm">{code}</strong><span className="ml-auto text-[11px] font-semibold text-emerald-800">{values[key] ? "Included" : "Not included"}</span>
                  </span>
                  <span className="mt-1 block text-xs font-semibold">{label}</span><span className="mt-1 block text-[11px] leading-4 text-stone-500">{help}</span>
                </label>
              ))}
            </div>
          </Panel>
        </aside>
        <main className="space-y-4">
          <div className="rounded-md border border-stone-200 bg-white p-3 shadow-sm">
            <div className="mb-2 text-sm font-bold text-stone-900">Edit included form</div>
            <div className="flex flex-wrap gap-2">
              {editorTabs.map((item) => (
                <button key={item.code} type="button" onClick={() => setActiveEditorForm(item.code)} className={`rounded-md border px-3 py-2 text-left text-xs ${activeEditorForm === item.code ? "border-emerald-700 bg-emerald-700 text-white" : "border-stone-200 bg-stone-50 text-stone-800"}`}>
                  <span className="block font-bold">{item.code}</span><span className="block opacity-80">{item.title}</span>
                </button>
              ))}
            </div>
          </div>
          {activeEditorForm === "SA100" ? (
            <OfficialFormDetails
              title="SA100 - Main tax return"
              formCode="SA100"
              endpoint={`/admin/accounting/clients/${clientId}/year-end-accounts/packs/${packId}/self-assessment/SA100-2026.pdf?read_only=true&editor=true`}
              fields={(form.sections || []).filter((section) => !["supplementary", "self_employment"].includes(section.id)).flatMap((section) => section.fields || [])}
              values={values}
              setValues={setValues}
              disabled={disabled}
            />
          ) : null}
          {activeEditorForm === selfEmploymentCode ? (
            <OfficialFormDetails
              title={`${selfEmploymentCode} - Self-employment`}
              formCode={selfEmploymentCode}
              endpoint={`/admin/accounting/clients/${clientId}/year-end-accounts/packs/${packId}/self-assessment/${selfEmploymentCode}-2026.pdf?read_only=true&editor=true`}
              fields={(form.sections || []).filter((section) => section.id === "self_employment").flatMap((section) => section.fields || [])}
              values={values}
              setValues={setValues}
              disabled={disabled}
            />
          ) : null}
          {selectedSupplementaryForms.filter((supplementary) => supplementary.code === activeEditorForm).map((supplementary) => (
            <SupplementaryFormEditor key={supplementary.code} supplementary={supplementary} values={values} setValues={setValues} disabled={disabled} clientId={clientId} packId={packId} />
          ))}
        </main>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => onDownload?.(activeEditorForm)} disabled={downloadDisabled}>Download saved {activeEditorForm} PDF</Button>
        <Button type="button" variant="outline" onClick={onReset} disabled={disabled}>Reset to automatic</Button>
        <Button type="button" onClick={onSave} disabled={disabled}>Save Self Assessment details</Button>
      </div>
    </div>
  );
}

const SA100_OVERLAYS = {
  3: [["utr",12.2,8.1,24,1.8],["national_insurance_number",54.7,87.8,27.4,2.15,"chars",9,[2,2,2,2,1]],["full_name",50.6,14.9,31,6.2],["date_of_birth",11.05,80.8,23.3,2.1,"chars",8,[2,2,4]],["phone",54.7,80.1,39.0,2.15,"chars",15],["address",11,87.2,36,6.2]],
  4: [["employment",15,24.4,2.5,2.2,"mark"],["self_employment",15,43.1,2.5,2.2,"mark"],["partnership",15,52.1,2.5,2.2,"mark"],["uk_property",15,63.6,2.5,2.2,"mark"],["foreign",15,81.7,2.5,2.2,"mark"],["trusts",15,92.5,2.5,2.2,"mark"],["capital_gains",58.6,24,2.5,2.2,"mark"],["residence",58.6,54.4,2.5,2.2,"mark"],["additional_information_pages",58.6,67.9,2.5,2.2,"mark"]],
  5: [["taxed_uk_interest",11,16.1,30,2.3,"money"],["untaxed_uk_interest",11,23,30,2.3,"money"],["uk_dividends",11,36.7,30,2.3,"money"],["other_taxable_income",11,81.8,30,2.3,"money"],["other_income_expenses",11,87.1,30,2.3,"money"],["tax_taken_off_other_income",11,92,30,2.3,"money"]],
  6: [["pension_relief_at_source",11,23.8,30,2.3,"money"],["gift_aid",11,46,30,2.3,"money"]],
  10: [["provisional_figures",11,17.1,2.5,2.2,"mark"],["declaration_date",11,48.8,24,2.2]],
};

const SA103S_OVERLAYS = {
  1: [
    ["full_name",11,16.1,36.4,2.2],["utr",54.7,16.1,27.2,2.2,"chars",10],
    ["business_description",11,24.2,36.4,4.1],["business_postcode",11,30.8,21.5,2.2,"chars",8],
    ["accounting_period_to",54.7,43.9,23,2.2,"datechars",8],
    ["turnover",11,59.8,22.2,2.2,"money"],["allowable_expenses",54.7,93.3,24.5,2.2,"money"],
  ],
  2: [
    ["net_profit",11,9.7,24.5,2.2,"profit"],["capital_allowances",11,32.0,24.5,2.2,"money"],
    ["loss_brought_forward",54.7,49.6,24.5,2.2,"money"],["cis_deductions",54.7,88.7,24.5,2.2,"money"],
  ],
};

const SA_SUPPLEMENTARY_PREVIEWS = [
  { key: "employment", code: "SA102", label: "Employment", folder: "sa102-2026", pages: 2 },
  { key: "partnership", code: "SA104S", label: "Partnership (short)", folder: "sa104s-2026", pages: 2 },
  { key: "uk_property", code: "SA105", label: "UK property", folder: "sa105-2026", pages: 2 },
  { key: "foreign", code: "SA106", label: "Foreign", folder: "sa106-2026", pages: 8 },
  { key: "trusts", code: "SA107", label: "Trusts etc.", folder: "sa107-2026", pages: 2 },
  { key: "capital_gains", code: "SA108", label: "Capital Gains Tax summary", folder: "sa108-2026", pages: 4 },
  { key: "residence", code: "SA109", label: "Residence and FIG regime", folder: "sa109-2026", pages: 4 },
  { key: "additional_information_pages", code: "SA101", label: "Additional information", folder: "sa101-2026", pages: 4 },
  { key: "tax_calculation_summary", code: "SA110", label: "Tax calculation summary", folder: "sa110-2026", pages: 2 },
];

const SUPPLEMENTARY_HEADER_OVERLAYS = [
  ["full_name", 10.2, 12.8, 33.5, 2.2],
  ["utr", 50.2, 12.8, 27.2, 2.2, "chars", 10],
];

function BoxedCharacters({ value, count, groups, align = "start" }) {
  const raw = String(value ?? "").replace(/[\s/-]/g, "").slice(0, count);
  const characters = (align === "end" ? raw.padStart(count, " ") : raw.padEnd(count, " ")).split("");
  if (groups?.length) {
    let offset = 0;
    return (
      <span className="flex h-full w-full items-stretch gap-[3.8%]">
        {groups.map((size, groupIndex) => {
          const groupCharacters = characters.slice(offset, offset + size);
          offset += size;
          return <span key={groupIndex} className="grid min-w-0" style={{ flexGrow: size, flexBasis: 0, gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}>{groupCharacters.map((character, index) => <span key={index} className="flex items-center justify-center font-mono text-[clamp(7px,1.1vw,13px)]">{character.trim()}</span>)}</span>;
        })}
      </span>
    );
  }
  return (
    <span className="grid h-full w-full" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
      {Array.from({ length: count }, (_, index) => <span key={index} className="flex items-center justify-center font-mono text-[clamp(7px,1.1vw,13px)]">{characters[index] || ""}</span>)}
    </span>
  );
}

function FormArtworkPage({ src, alt, overlays, values }) {
  const display = (value, kind) => {
    if (kind === "mark") return value ? "X" : "";
    if (kind === "profit") return Number(value) > 0 ? Number(value).toFixed(2) : "";
    if (kind === "money" && value !== "" && value != null) return Number(value).toFixed(2);
    return value ?? "";
  };
  return (
    <section className="relative overflow-hidden border border-stone-300 bg-white shadow-sm">
      <img src={src} alt={alt} className="block h-auto w-full" />
      {(overlays || []).map(([key,left,top,width,height,kind,count,groups]) => {
        const value = display(values[key], kind);
        if (value === "") return null;
        return (
          <span key={`${src}-${key}`} className={`pointer-events-none absolute flex overflow-hidden px-[2px] font-mono text-stone-950 ${kind === "mark" ? "items-center justify-center text-base font-bold" : "items-center justify-end text-[clamp(8px,1.25vw,14px)]"}`} style={{ left:`${left}%`, top:`${top}%`, width:`${width}%`, height:`${height}%` }}>
            {kind === "chars" || kind === "datechars" ? <BoxedCharacters value={kind === "datechars" ? String(value).split("-").reverse().join("") : value} count={count} groups={groups} /> : value}
          </span>
        );
      })}
    </section>
  );
}

function SelfAssessmentPreview({ form, values, pdfForms = [], clientId, packId }) {
  const [activePackage, setActivePackage] = useState("SA100");
  const previewValues = { ...values, ...(form?.auto_values || {}) };
  const selfEmploymentPackage = previewValues.self_employment ? {
    code: previewValues.self_employment_schedule === "SA103S" ? "SA103S" : "SA103F",
    label: previewValues.self_employment_schedule === "SA103S" ? "Self-employment (short)" : "Self-employment (full)",
  } : null;
  const includedSupplementary = SA_SUPPLEMENTARY_PREVIEWS.filter((schedule) => previewValues[schedule.key]);
  const packages = [{ code: "SA100", label: "Main tax return" }, ...(selfEmploymentPackage ? [selfEmploymentPackage] : []), ...includedSupplementary];
  const packageCodes = packages.map((item) => item.code).join("|");
  useEffect(() => {
    if (!packageCodes.split("|").includes(activePackage)) setActivePackage("SA100");
  }, [activePackage, packageCodes]);
  const activePdfStatus = pdfForms.find((item) => item.form_code === `${activePackage}-2026`);
  const nativeAvailable = !!activePdfStatus?.available;
  const populatedFormRevision = JSON.stringify(previewValues);
  const nativePdfUrl = "";
  const nativePdfError = "";
  if (!form) return <Panel title="Self Assessment preview"><p className="text-sm text-stone-600">No return is available yet.</p></Panel>;
  if (nativeAvailable) {
    const registeredPackages = packages.map((item) => {
      const status = pdfForms.find((formStatus) => formStatus.form_code === `${item.code}-2026`);
      return {
        ...item,
        status: status?.status,
        available: !!status?.available,
      };
    });
    return (
      <OfficialFormPreview
        forms={registeredPackages}
        activeCode={activePackage}
        onActiveCodeChange={setActivePackage}
        endpoint={`/admin/accounting/clients/${clientId}/year-end-accounts/packs/${packId}/self-assessment/${activePackage}-2026.pdf?read_only=true`}
        revision={populatedFormRevision}
        banner="Read-only official form preview. Amend values in Details & sections; every module now uses the shared package viewer."
      />
    );
  }
  return (
    <div className="mx-auto max-w-[900px] space-y-4">
      <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">Read-only official SA100 2026 preview. Amend values in Details &amp; sections. The two information-sheet pages are intentionally excluded.</div>
      <div className="rounded-md border border-stone-200 bg-white p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-sm font-bold text-stone-900">Forms included in this return</span>
          <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-900">{packages.length} forms</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {packages.map((item) => (
            <button key={item.code} type="button" onClick={() => setActivePackage(item.code)} className={`rounded-md border px-3 py-2 text-left text-xs ${activePackage === item.code ? "border-emerald-700 bg-emerald-700 text-white" : "border-stone-200 bg-stone-50 text-stone-800"}`}>
              <span className="block font-bold">{item.code}</span><span className="block opacity-80">{item.label}</span>
              <span className="mt-1 block opacity-80">{pdfForms.find((formStatus) => formStatus.form_code === `${item.code}-2026`)?.status || "Needs PDF Editor preparation"}</span>
            </button>
          ))}
        </div>
      </div>
      {nativeAvailable ? (
        nativePdfUrl ? <iframe title={`${activePackage} populated system PDF`} src={`${nativePdfUrl}#toolbar=1&navpanes=0&view=FitH`} className="h-[78vh] min-h-[720px] w-full border-0 bg-white shadow-sm" /> :
          <div className={`rounded-md border p-5 text-center text-sm ${nativePdfError ? "border-red-200 bg-red-50 text-red-800" : "border-stone-200 bg-white text-stone-600"}`}>{nativePdfError || `Preparing populated ${activePackage} PDF…`}</div>
      ) : null}
      {!nativeAvailable && activePackage === "SA100" ? [3,4,5,6,7,8,9,10].map((page) => (
        <FormArtworkPage key={page} src={`/sa100-2026/page-${String(page).padStart(2, "0")}.png`} alt={`Official SA100 page TR${page - 2}`} overlays={SA100_OVERLAYS[page]} values={previewValues} />
      )) : null}
      {!nativeAvailable && activePackage === "SA103S" ? (
        <>
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">Supplementary page provided: SA103S Self-employment (short)</div>
          {[1,2].map((page) => <FormArtworkPage key={`sa103s-${page}`} src={`/sa103s-2026/page-${page}.png`} alt={`Official SA103S 2026 page ${page}`} overlays={SA103S_OVERLAYS[page]} values={previewValues} />)}
        </>
      ) : null}
      {!nativeAvailable && activePackage === "SA103F" ? (
        <>
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">Supplementary page provided: SA103F Self-employment (full)</div>
          {Array.from({ length: 6 }, (_, index) => <FormArtworkPage key={`sa103f-${index + 1}`} src={`/sa103f-2026/page-${index + 1}.png`} alt={`Official SA103F 2026 page ${index + 1}`} overlays={index === 0 ? SUPPLEMENTARY_HEADER_OVERLAYS : []} values={previewValues} />)}
        </>
      ) : null}
      {!nativeAvailable && includedSupplementary.filter((schedule) => activePackage === schedule.code).map((schedule) => (
        <div key={schedule.code} className="space-y-4">
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">Supplementary page provided: {schedule.code} {schedule.label}</div>
          {Array.from({ length: schedule.pages }, (_, index) => <FormArtworkPage key={`${schedule.code}-${index + 1}`} src={`/${schedule.folder}/page-${index + 1}.png`} alt={`Official ${schedule.code} 2026 page ${index + 1}`} overlays={index === 0 ? SUPPLEMENTARY_HEADER_OVERLAYS : []} values={previewValues} />)}
        </div>
      ))}
    </div>
  );
}

const CT600_SUPPLEMENTARY_HELP = {
  "95": { form: "CT600A", trigger: "Use where a close company made loans or arrangements conferring benefits on participators or their associates and the relevant amounts require reporting.", information: "Loan or arrangement amounts, section 455 tax, repayments, releases or write-offs, and any section 458 relief." },
  "100": { form: "CT600B", trigger: "Use for controlled foreign companies, relevant foreign permanent establishment exemptions, hybrid mismatches or other matters covered by CT600B.", information: "Foreign-company interests, exemptions, CFC charge information, hybrid mismatch adjustments and supporting calculations." },
  "105": { form: "CT600C", trigger: "Use when claiming or surrendering group or consortium relief, including relevant carried-forward amounts.", information: "Claimant and surrendering company details, periods, surrender amounts, authorisations and relief calculations." },
  "110": { form: "CT600D", trigger: "Use for companies carrying on the insurance activities and claims covered by the insurance supplementary return.", information: "Insurance business classifications, relevant profits, claims and insurance-specific tax calculations." },
  "115": { form: "CT600E", trigger: "Use where the company is a charity or Community Amateur Sports Club claiming exemption for all or part of its income or gains.", information: "Charity/CASC references, exemption status, application of income and gains, repayment information and declaration." },
  "120": { form: "CT600F", trigger: "Use where the company operates ships and is party to a Tonnage Tax election.", information: "Tonnage Tax period, qualifying activities, relevant profits and tax calculation figures." },
  "125": { form: "CT600G", trigger: "Use where the company must provide the Northern Ireland supplementary return information.", information: "Northern Ireland trading activity, qualifying profits, losses, workforce and regional calculation data." },
  "130": { form: "CT600H", trigger: "Use where reportable cross-border royalty payments were made.", information: "Recipient, territory, payment, withholding and treaty or exemption details." },
  "135": { form: "CT600I", trigger: "Use where the company carries on a ring-fence trade, generally concerning UK oil extraction or exploitation rights.", information: "Ring-fence profits, losses, allowances and supplementary-charge calculations." },
  "140": { form: "CT600J", trigger: "Use where the company is party to notifiable tax-avoidance arrangements requiring disclosure.", information: "Disclosure reference numbers, arrangement periods and related tax effects." },
  "141": { form: "CT600K", trigger: "Use where the company is chargeable to Corporation Tax on restitution interest.", information: "Restitution-interest amounts, tax charge and related computations." },
  "142": { form: "CT600L", trigger: "Use for relevant Research and Development claims, including RDEC or payable SME credit claims for the applicable period.", information: "R&D scheme, qualifying expenditure, expenditure credit or payable credit, claim notification and additional-information references." },
  "143": { form: "CT600M", trigger: "Use where the company claims qualifying allowances relating to a Freeport or Investment Zone tax site.", information: "Site, qualifying expenditure, allowances and relevant dates." },
  "144": { form: "CT600N", trigger: "Use where Residential Property Developer Tax is payable.", information: "Residential-property development profits, allowance, group allocation and tax payable." },
  "96": { form: "CT600P", trigger: "Use where the company claims a creative-industry tax relief or expenditure credit covered by CT600P.", information: "Eligible production type, qualifying expenditure, surrenderable loss, credit or relief and production-specific declarations." },
};

function ct600FieldHelp(field) {
  const supplementary = CT600_SUPPLEMENTARY_HELP[field.box];
  if (supplementary) {
    return {
      title: `${supplementary.form} supplementary return`,
      decision: supplementary.trigger,
      doNotUse: `Do not select this box merely because ${supplementary.form} could be relevant. Confirm that the company has the transaction, activity, status or claim covered by that supplementary return.`,
      example: `Select box ${field.box} when the reviewed facts require ${supplementary.form}; the supplementary workflow must then be completed before filing.`,
      evidence: supplementary.information,
      effect: `Selecting this box makes ${supplementary.form} part of the Company Tax Return and activates its data collection and validation requirements.`,
      nextStep: `Complete and validate ${supplementary.form} before generating the filing package.`,
      sourceUrl: "https://www.gov.uk/guidance/the-company-tax-return-guide",
      sourceLabel: "HMRC Company Tax Return guide",
    };
  }
  const specificGuidance = {
    "326": {
      decision: "Count companies associated with this company at any time during the accounting period. Broadly, companies are associated when one controls the other or both are under common control.",
      doNotUse: "Do not count the company itself. Do not assume that every company in a commercial network is associated; control and the statutory exceptions must be reviewed.",
      example: "If the same shareholder controls this company and two other companies during the period, enter 2, subject to the detailed associated-company rules.",
      evidence: "Group structure, shareholdings, voting rights, loan relationships and the associated-company review.",
      effect: "This number can reduce the £50,000 and £250,000 small-profits and marginal-relief limits.",
    },
    "327": {
      decision: "Enter the associated-company count applicable to the first Corporation Tax financial year covered by this return.",
      doNotUse: "Leave blank when the accounting period does not straddle Corporation Tax financial years or there were no associated companies in that financial year.",
      example: "A December year end spans financial years beginning 1 April 2025 and 1 April 2026. Record the count applying to the first part here.",
      evidence: "Dated group structure and control analysis for the first financial-year segment.",
      effect: "Used to adjust the small-profits and marginal-relief thresholds for the first financial year.",
    },
    "328": {
      decision: "Enter the associated-company count applicable to the second Corporation Tax financial year covered by this return.",
      doNotUse: "Leave blank when only one Corporation Tax financial year is covered.",
      example: "If a new controlled company joined the group after 1 April, the second-year count may differ from box 327.",
      evidence: "Dated group structure and control analysis for the second financial-year segment.",
      effect: "Used to adjust the thresholds and tax calculation for the second financial year.",
    },
    "329": {
      decision: "Select X when profits in the relevant post-1 April 2023 financial year qualify for the 19% small-profits rate or fall within the marginal-relief band. For a 12-month period with no associated companies, the standard limits are £50,000 and £250,000. Adjust both limits for short periods and associated companies.",
      doNotUse: "Do not select for a non-UK resident company, a close investment-holding company, or where augmented profits exceed the adjusted upper limit. Ring-fence profits require their own rate review.",
      example: "With no associated companies, £40,000 qualifying profits normally uses the 19% small-profits rate. £90,000 profits may receive marginal relief. With 3 associated companies, the standard limits are divided by 4: £12,500 and £62,500.",
      evidence: "Taxable total profits, augmented profits including relevant distributions, period length, associated-company count and the marginal-relief calculation.",
      effect: "Confirms why boxes 330–425 use the small-profits or marginal-relief calculation. Any marginal relief calculated is entered in box 435.",
      sourceUrl: "https://www.gov.uk/guidance/corporation-tax-marginal-relief",
      sourceLabel: "HMRC Marginal Relief guidance",
    },
    "435": {
      decision: "Enter marginal relief only when the company is eligible and its augmented profits fall between the adjusted lower and upper limits.",
      doNotUse: "Do not enter the difference between 19% and 25% as a simple flat percentage. Use the statutory marginal-relief calculation.",
      example: "HMRC's example for £90,000 taxable profits and £98,000 augmented profits calculates £2,094 relief, reducing £22,500 main-rate tax to £20,406.",
      evidence: "Marginal-relief computation showing the standard fraction, adjusted upper limit, augmented profits and taxable total profits.",
      effect: "Box 435 is deducted from box 430 to produce Corporation Tax chargeable in box 440.",
      sourceUrl: "https://www.gov.uk/hmrc-internal-manuals/company-taxation-manual/ctm03925",
      sourceLabel: "HMRC worked marginal-relief example",
    },
  };
  const specific = specificGuidance[String(field.box)];
  const typeGuidance = {
    boolean: {
      decision: `Select X only when “${field.label}” is factually true for this return period and the relevant tax conditions have been checked.`,
      doNotUse: "Do not select merely because the transaction or relief might apply in a later period, or because supporting work has not yet been completed.",
      example: `If the completed tax computation and supporting records confirm ${String(field.label || "").toLowerCase()}, select X; otherwise leave the box clear.`,
      evidence: "Retain the relevant computation, election, claim, contract, group analysis or other source record.",
      effect: "Selecting the box can activate additional validation, supplementary pages, disclosures or a different tax calculation.",
    },
    money: {
      decision: `Enter an amount only when the tax computation contains a separately supportable figure for “${field.label}”.`,
      doNotUse: "Do not copy a Trial Balance amount without applying the Corporation Tax adjustments required for this box. Leave blank rather than estimating unless HMRC permits an estimate and it is disclosed.",
      example: "If the supporting schedule calculates £12,500.00 for this line, enter 12500.00 and cross-reference that schedule.",
      evidence: "Corporation Tax computation, nominal-account reconciliation and the detailed supporting schedule.",
      effect: "The amount feeds the relevant subtotal, relief, liability or repayment calculation and must reconcile to connected boxes.",
    },
    integer: {
      decision: `Enter the whole-number count or year only after completing the supporting review for “${field.label}”.`,
      doNotUse: "Do not enter approximate counts or include the company itself where the instruction asks for other companies.",
      example: "If the reviewed schedule supports a count of 2, enter 2 rather than a narrative description.",
      evidence: "Retain the dated schedule or company/group record supporting the count.",
      effect: "The value may change thresholds, eligibility or the allocation of profits between financial years.",
    },
    percentage: {
      decision: "Enter the Corporation Tax rate applying to the profit in the same table row and financial year.",
      doNotUse: "Do not enter an effective tax rate from the accounts or a blended rate unless that row specifically represents the calculated statutory rate.",
      example: "For qualifying small profits in financial year 2026, enter 19.00; for main-rate profits, enter 25.00.",
      evidence: "Applicable HMRC rate table and the profit-allocation calculation for the accounting period.",
      effect: "The rate is applied to the profit in the row to calculate its corresponding tax box.",
    },
    date: {
      decision: "Use the legally relevant date from the accounts period, approval record or declaration named by the field.",
      doNotUse: "Do not use the data-entry date unless it is also the required legal date.",
      example: "For a period ending 30 April 2026, enter 2026-04-30.",
      evidence: "Financial-year record, board minutes, signed declaration or statutory filing record.",
      effect: "Dates control period validity and whether the return and related tax rules apply.",
    },
    textarea: {
      decision: "Provide an explanation when HMRC needs narrative information to understand why the normal attachment or treatment is not being followed.",
      doNotUse: "Do not use internal abbreviations or refer only to a working-paper code that HMRC cannot access.",
      example: "State the reason, the period affected and what supporting document or computation is included instead.",
      evidence: "Supporting correspondence, accounts-period analysis and attachment record.",
      effect: "The explanation supports validation of an exceptional return treatment.",
    },
    text: {
      decision: `Enter the statutory identifier or legal description requested for “${field.label}” from the authoritative client record.`,
      doNotUse: "Do not use informal abbreviations, unverified names or an internal reference where a statutory identifier is required.",
      example: "Copy the registered company number or UTR exactly as recorded, including leading zeroes.",
      evidence: "Companies House record, HMRC notice, bank mandate or signed authority, depending on the field.",
      effect: "The value identifies the company, payment destination, nominee or declaration in the filed return.",
    },
  };
  const decisionHelp = specific || typeGuidance[field.type] || typeGuidance.text;
  return {
    title: `Box ${field.box} - ${field.label}`,
    ...decisionHelp,
    nextStep: field.source === "accounts"
      ? "This value is normally populated from the client record, accounts pack, Trial Balance or computation. Review it before filing; a saved override replaces the automatic value."
      : "This is currently a manual return input. A later automation rule can replace it when an authoritative source is available.",
    sourceUrl: decisionHelp.sourceUrl || "https://www.gov.uk/guidance/the-company-tax-return-guide",
    sourceLabel: decisionHelp.sourceLabel || "HMRC Company Tax Return guide",
  };
}

function RetiredCt600CardEditor({ form = {}, editorSections = [], visibleBoxes = [], values = {}, setValues, onSave, disabled }) {
  const [openHelpBox, setOpenHelpBox] = useState("");
  const visibleBoxSet = useMemo(() => new Set(visibleBoxes.map(String)), [visibleBoxes]);
  const sourceSections = editorSections.length ? editorSections : (form.sections || []);
  const visibleSections = sourceSections
    .map((section) => ({ ...section, fields: (section.fields || []).filter((field) => visibleBoxSet.has(String(field.box))) }))
    .filter((section) => section.fields.length);
  function update(box, value) {
    setValues((current) => ({ ...current, [box]: value }));
  }
  return (
    <Panel title={`${form.label || "CT600"} - return details`}>
      <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
        The return is organised by subject instead of PDF page. Fields marked <strong>accounts</strong> are prefilled from the client, Trial Balance or accounts pack. The Preview tab retains the official 12-page CT600 layout.
      </div>
      <div className="space-y-3">
        {visibleSections.map((section, sectionIndex) => (
          <details key={section.id} open={sectionIndex === 0} className="rounded-md border border-stone-200 bg-white">
            <summary className="cursor-pointer list-none bg-stone-50 px-4 py-3 text-stone-900">
              <span className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-3">
                  <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-emerald-100 px-2 text-xs font-bold text-emerald-800">{section.number || sectionIndex + 1}</span>
                  <span className="font-semibold">{section.title}</span>
                </span>
                <span className="text-xs font-normal text-stone-500">{section.fields.length} {section.fields.length === 1 ? "field" : "fields"}</span>
              </span>
            </summary>
            <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
              {(section.fields || []).map((field) => (
                field.type === "boolean" ? (
                  <div key={field.box} className="rounded-md border border-stone-200 p-3 text-sm">
                    <div className="flex items-start gap-3">
                      <input type="checkbox" checked={!!values[field.box]} disabled={disabled} onChange={(event) => update(field.box, event.target.checked)} className="mt-1" />
                      <label className="min-w-0 flex-1"><strong>Box {field.box}</strong> - {field.label}<span className="mt-1 block text-xs text-stone-500">{field.source}</span></label>
                      <button type="button" aria-label={`Help for box ${field.box}`} aria-expanded={openHelpBox === field.box} onClick={() => setOpenHelpBox((current) => current === field.box ? "" : field.box)} className="rounded-full p-1 text-blue-700 hover:bg-blue-50">
                        <CircleHelp className="h-4 w-4" />
                      </button>
                    </div>
                    {openHelpBox === field.box ? <Ct600BoxHelp field={field} selected={!!values[field.box]} /> : null}
                    {!!values[field.box] && CT600_SUPPLEMENTARY_HELP[field.box] ? (
                      <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                        Next step required: complete the {CT600_SUPPLEMENTARY_HELP[field.box].form} supplementary workflow before validation.
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div key={field.box} className="block text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-stone-800">Box {field.box} - {field.label}</span>
                      <button type="button" aria-label={`Help for box ${field.box}`} aria-expanded={openHelpBox === field.box} onClick={() => setOpenHelpBox((current) => current === field.box ? "" : field.box)} className="rounded-full p-1 text-blue-700 hover:bg-blue-50">
                        <CircleHelp className="h-4 w-4" />
                      </button>
                    </div>
                    {field.type === "textarea" ? (
                      <textarea value={values[field.box] ?? ""} disabled={disabled} onChange={(event) => update(field.box, event.target.value)} className="mt-1 min-h-20 w-full rounded-md border border-stone-200 px-3 py-2" />
                    ) : (
                      <Input
                        type={field.type === "date" ? "date" : ["money", "integer", "percentage"].includes(field.type) ? "number" : "text"}
                        step={field.type === "money" || field.type === "percentage" ? "0.01" : undefined}
                        value={values[field.box] ?? ""}
                        disabled={disabled}
                        onChange={(event) => update(field.box, event.target.value)}
                        className="mt-1 h-9"
                      />
                    )}
                    <span className="mt-1 block text-xs text-stone-500">{field.source}</span>
                    {openHelpBox === field.box ? <Ct600BoxHelp field={field} selected={false} /> : null}
                  </div>
                )
              ))}
            </div>
          </details>
        ))}
      </div>
      <div className="mt-4 flex justify-end"><Button type="button" onClick={onSave} disabled={disabled}>Save CT600 form options</Button></div>
    </Panel>
  );
}

function sanitiseCt600Input(field, rawValue) {
  const constraint = field.constraint || {};
  let value = String(rawValue ?? "");
  if (field.type === "money") {
    value = value.replace(/[^\d.-]/g, "");
    const negative = value.startsWith("-");
    value = value.replace(/-/g, "");
    const [whole = "", ...decimalParts] = value.split(".");
    value = `${negative ? "-" : ""}${whole.slice(0, 13)}${decimalParts.length ? `.${decimalParts.join("").slice(0, 2)}` : ""}`;
  } else if (field.type === "percentage") {
    value = value.replace(/[^\d.]/g, "");
    const [whole = "", ...decimalParts] = value.split(".");
    value = `${whole.slice(0, 3)}${decimalParts.length ? `.${decimalParts.join("").slice(0, 2)}` : ""}`;
  } else if (field.type === "integer") {
    value = value.replace(/\D/g, "");
  } else if (field.type === "date") {
    value = value.replace(/[^\d-]/g, "");
  }
  return constraint.max_length ? value.slice(0, Number(constraint.max_length)) : value;
}

function Ct600FormEditor({ form = {}, editorSections = [], visibleBoxes = [], automaticBoxes = [], values = {}, setValues, onSave, disabled }) {
  const [openHelpBox, setOpenHelpBox] = useState("");
  const visibleBoxSet = useMemo(() => new Set((visibleBoxes || []).map(String)), [visibleBoxes]);
  const automaticBoxSet = useMemo(() => new Set((automaticBoxes || []).map(String)), [automaticBoxes]);
  const sections = (editorSections.length ? editorSections : (form.sections || []))
    .map((section) => ({ ...section, fields: (section.fields || []).filter((field) => visibleBoxSet.has(String(field.box))) }))
    .filter((section) => section.fields.length);
  const fieldsByBox = useMemo(() => Object.fromEntries(
    (form.sections || []).flatMap((section) => (section.fields || []).map((field) => [String(field.box), field]))
  ), [form.sections]);
  const update = (box, value) => setValues((current) => ({ ...current, [box]: value }));
  return (
    <section className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
      <header className="border-b-4 border-emerald-700 bg-emerald-50 px-5 py-4">
        <div className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-800">HM Revenue &amp; Customs</div>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div><h3 className="text-2xl font-bold text-slate-950">Company Tax Return</h3><p className="text-sm font-semibold text-slate-600">{form.version || "CT600 (2026) Version 3"}</p></div>
          <div className="flex flex-wrap gap-4 text-xs text-slate-600">
            <span><span className="mr-1 inline-block h-3 w-3 border border-slate-400 bg-slate-200 align-middle" />Automatically populated</span>
            <span><span className="mr-1 inline-block h-3 w-3 border border-emerald-500 bg-white align-middle" />Manual entry</span>
          </div>
        </div>
        <p className="mt-2 text-sm text-slate-600">Complete the return here. The Preview tab is a read-only representation of the official HMRC form.</p>
      </header>
      <div className="space-y-5 bg-slate-100 p-3 md:p-5">
        {sections.map((section, sectionIndex) => (
          <article key={section.id} className="mx-auto max-w-6xl overflow-hidden border border-cyan-700/30 bg-[#e2f1f0] shadow-sm">
            <div className="border-b border-cyan-700/30 bg-white px-4 py-3">
              <div className="text-xs font-bold uppercase tracking-wide text-emerald-700">Section {section.number || sectionIndex + 1}</div>
              <h4 className="text-xl font-semibold text-slate-950">{section.title}</h4>
            </div>
            <div>
              {(section.fields || []).filter((field) => !CT600_OFFICIAL_TABLE_LAYOUTS.some(
                (layout) => layout.sectionId === section.id && layout.rows.flat().includes(String(field.box))
              )).map((field) => {
                const box = String(field.box);
                const automatic = automaticBoxSet.has(box);
                const locked = disabled || automatic;
                const showHelp = openHelpBox === box;
                return (
                  <div key={box} className="border-b border-cyan-700/20 last:border-b-0">
                    <div className="grid min-h-14 items-center gap-3 px-3 py-2 sm:grid-cols-[3.25rem_minmax(0,1fr)_minmax(10rem,18rem)_2.25rem]">
                      <div className="inline-flex h-7 min-w-10 items-center justify-center bg-[#009b98] px-2 text-xs font-bold text-white">{box}</div>
                      <div>
                        <div className="font-semibold leading-snug text-slate-950">{field.label}</div>
                        <div className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">{automatic ? "Automatically populated" : "Manual entry"}{field.constraint?.placeholder ? ` · ${field.constraint.placeholder}` : ""}</div>
                      </div>
                      <div className="flex justify-end">
                        {field.type === "boolean" ? (
                          <button
                            type="button"
                            aria-label={`Box ${box} - ${field.label}`}
                            aria-disabled={locked}
                            onClick={() => { if (!locked) update(box, !values[box]); }}
                            className={`flex h-9 w-9 items-center justify-center border text-lg font-bold ${locked ? "cursor-not-allowed border-slate-400 bg-slate-200 text-slate-700" : "border-emerald-600 bg-white text-slate-950 hover:bg-emerald-50"}`}
                          >{values[box] ? "X" : ""}</button>
                        ) : field.type === "textarea" ? (
                          <textarea value={values[box] ?? ""} readOnly={locked} maxLength={field.constraint?.max_length} placeholder={field.constraint?.placeholder} onChange={(event) => update(box, sanitiseCt600Input(field, event.target.value))} className={`min-h-20 w-full border px-3 py-2 text-sm outline-none ${locked ? "cursor-not-allowed border-slate-400 bg-slate-200 text-slate-700" : "border-emerald-600 bg-white focus:ring-2 focus:ring-emerald-500"}`} />
                        ) : (
                          <Input
                            type="text"
                            inputMode={["money", "percentage"].includes(field.type) ? "decimal" : ["integer", "date"].includes(field.type) ? "numeric" : "text"}
                            maxLength={field.constraint?.max_length}
                            pattern={field.constraint?.pattern}
                            placeholder={field.constraint?.placeholder}
                            value={values[box] ?? ""}
                            readOnly={locked}
                            onChange={(event) => update(box, sanitiseCt600Input(field, event.target.value))}
                            className={`h-9 rounded-none text-right font-mono ${locked ? "cursor-not-allowed border-slate-400 bg-slate-200 text-slate-700" : "border-emerald-600 bg-white"}`}
                          />
                        )}
                      </div>
                      <button type="button" aria-label={`Guidance for box ${box}`} aria-expanded={showHelp} onClick={() => setOpenHelpBox((current) => current === box ? "" : box)} className="justify-self-end rounded-full p-1.5 text-blue-700 hover:bg-blue-100">
                        <CircleHelp className="h-5 w-5" />
                      </button>
                    </div>
                    {showHelp ? <div className="border-t border-blue-200 bg-white px-4 pb-4"><Ct600BoxHelp field={field} selected={!!values[box]} /></div> : null}
                    {!!values[box] && CT600_SUPPLEMENTARY_HELP[box] ? (
                      <div className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">Complete the {CT600_SUPPLEMENTARY_HELP[box].form} supplementary workflow before validation.</div>
                    ) : null}
                  </div>
                );
              })}
              {CT600_OFFICIAL_TABLE_LAYOUTS.filter((layout) => layout.sectionId === section.id).map((layout) => (
                <Ct600OfficialTable
                  key={layout.title}
                  layout={layout}
                  fieldsByBox={fieldsByBox}
                  values={values}
                  automaticBoxSet={automaticBoxSet}
                  disabled={disabled}
                  update={update}
                  openHelpBox={openHelpBox}
                  setOpenHelpBox={setOpenHelpBox}
                />
              ))}
            </div>
          </article>
        ))}
      </div>
      <footer className="flex justify-end border-t border-slate-200 bg-white px-5 py-4"><Button type="button" onClick={onSave} disabled={disabled} style={{ background: "var(--brand)" }}>Save CT600 return details</Button></footer>
    </section>
  );
}

function Ct600BoxHelp({ field, selected }) {
  const help = ct600FieldHelp(field);
  return (
    <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-4 text-xs leading-relaxed text-blue-950">
      <div className="text-sm font-semibold">{help.title}</div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded border border-emerald-200 bg-white p-3"><strong className="block text-emerald-800">Use this box when</strong><span>{help.decision}</span></div>
        <div className="rounded border border-amber-200 bg-white p-3"><strong className="block text-amber-800">Do not use it when</strong><span>{help.doNotUse}</span></div>
        <div className="rounded border border-blue-200 bg-white p-3"><strong className="block text-blue-800">Example</strong><span>{help.example}</span></div>
        <div className="rounded border border-slate-200 bg-white p-3"><strong className="block text-slate-800">Evidence to retain</strong><span>{help.evidence}</span></div>
      </div>
      <p className="mt-3"><strong>Effect on the return:</strong> {help.effect}</p>
      <p className="mt-2"><strong>{selected ? "What happens next:" : "Data source and validation:"}</strong> {help.nextStep}</p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-blue-200 pt-3">
        <a href={help.sourceUrl} target="_blank" rel="noreferrer" className="font-semibold text-blue-800 underline">{help.sourceLabel}</a>
        <span className="text-blue-800">Decision aid only; period-valid HMRC rules and professional judgement remain authoritative.</span>
      </div>
    </div>
  );
}

const CT600_OFFICIAL_TABLE_LAYOUTS = [
  {
    sectionId: "tax_calculation",
    title: "Enter how much profit has to be charged and at what rate",
    columns: ["Financial year (yyyy)", "Amount of profit", "Rate of tax %", "Tax"],
    rows: [
      ["330", "335", "340", "345"], [null, "350", "355", "360"], [null, "365", "370", "375"],
      ["380", "385", "390", "395"], [null, "400", "405", "410"], [null, "415", "420", "425"],
    ],
  },
  {
    sectionId: "capital_allowances",
    title: "Allowances and charges in the calculation of trading profits and losses",
    columns: ["Description", "Capital allowances", "Balancing charges / disposal value"],
    rows: [
      ["Annual investment allowance", "690", null], ["Full expensing", "688", "689"],
      ["Machinery and plant – super-deduction", "691", "692"], ["Machinery and plant – special rate allowance", "693", "694"],
      ["Machinery and plant – special rate pool", "695", "700"], ["Machinery and plant – main pool", "705", "710"],
      ["Structures and buildings", "711", null], ["Business premises renovation", "715", "720"],
      ["Other allowances and charges", "725", "730"], ["Electric vehicle charge-points", "713", "714"],
      ["Enterprise zones", "721", "722"], ["Zero-emission goods vehicles", "723", "724"], ["Zero-emission cars", "726", "727"],
    ],
  },
  {
    sectionId: "capital_allowances",
    title: "Allowances and charges not included in the calculation of trading profits and losses",
    columns: ["Description", "Capital allowances", "Balancing charges / disposal value"],
    rows: [
      ["Annual investment allowance", "735", null], ["Structures and buildings", "736", null], ["Full expensing", "733", "734"],
      ["Business premises renovation", "740", "745"], ["Machinery and plant – super-deduction", "741", "742"],
      ["Machinery and plant – special rate allowance", "743", "744"], ["Other allowances and charges", "750", "755"],
      ["Electric vehicle charge-points", "737", "738"], ["Enterprise zones", "746", "747"],
      ["Zero-emission goods vehicles", "748", "749"], ["Zero-emission cars", "751", "752"],
    ],
  },
];

function Ct600OfficialTable({ layout, fieldsByBox, values, automaticBoxSet, disabled, update, openHelpBox, setOpenHelpBox }) {
  const taxTable = layout.columns.length === 4;
  const renderCell = (box, columnIndex) => {
    if (!box) return <td key={`blank-${columnIndex}`} className="border border-cyan-700/30 bg-[#e2f1f0]" />;
    const inferredType = taxTable && columnIndex === 0 ? "integer" : taxTable && columnIndex === 2 ? "percentage" : "money";
    const fallbackConstraint = inferredType === "percentage"
      ? { max_length: 6, placeholder: "0.00%" }
      : inferredType === "integer"
        ? { max_length: 4, placeholder: "YYYY" }
        : { max_length: 16, placeholder: "0.00" };
    const field = { box, label: `Official CT600 box ${box}`, source: "manual", constraint: fallbackConstraint, ...(fieldsByBox[box] || {}), type: inferredType };
    const automatic = automaticBoxSet.has(box);
    const locked = disabled || automatic;
    return (
      <td key={box} className="border border-cyan-700/30 bg-white p-0">
        <div className="grid min-h-11 grid-cols-[3.6rem_minmax(0,1fr)_2rem] items-stretch">
          <div className="flex items-center justify-center bg-[#009b98] px-2 text-xs font-bold text-white">{box}</div>
          <div className="relative flex items-center">
            {["money"].includes(field.type) || (!taxTable && columnIndex > 0) ? <span className="pl-2 text-slate-500">£</span> : null}
            <input
              type="text"
              inputMode={field.type === "integer" ? "numeric" : "decimal"}
              maxLength={field.constraint?.max_length}
              placeholder={field.constraint?.placeholder}
              value={values[box] ?? ""}
              readOnly={locked}
              onChange={(event) => update(box, sanitiseCt600Input(field, event.target.value))}
              className={`h-full min-w-0 flex-1 border-0 px-2 text-right font-mono outline-none ${locked ? "cursor-not-allowed bg-slate-200 text-slate-700" : "bg-white focus:ring-2 focus:ring-inset focus:ring-emerald-500"}`}
            />
            {field.type === "percentage" || (taxTable && columnIndex === 2) ? <span className="pr-2 text-slate-500">%</span> : null}
          </div>
          <button type="button" aria-label={`Guidance for box ${box}`} onClick={() => setOpenHelpBox((current) => current === box ? "" : box)} className="flex items-center justify-center text-blue-700 hover:bg-blue-50"><CircleHelp className="h-4 w-4" /></button>
        </div>
      </td>
    );
  };
  return (
    <div className="border-t-4 border-white">
      <div className="border-b border-cyan-700/30 bg-[#e2f1f0] px-4 py-3 text-lg font-medium text-slate-950">{layout.title}</div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] table-fixed border-collapse">
          <thead><tr>{layout.columns.map((column, index) => <th key={column} className={`border border-cyan-700/30 bg-[#e2f1f0] px-3 py-3 text-center text-sm font-bold ${taxTable ? "" : index === 0 ? "w-[32%] text-left" : ""}`}>{column}</th>)}</tr></thead>
          <tbody>
            {layout.rows.map((row, rowIndex) => (
              <tr key={`${layout.title}-${rowIndex}`}>
                {!taxTable ? <th className="border border-cyan-700/30 bg-[#e2f1f0] px-3 py-2 text-left text-sm font-semibold">{row[0]}</th> : null}
                {(taxTable ? row : row.slice(1)).map((box, columnIndex) => renderCell(box, columnIndex))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {openHelpBox && layout.rows.flat().includes(openHelpBox) ? (
        <div className="border-t border-blue-200 bg-white px-4 pb-4"><Ct600BoxHelp field={fieldsByBox[openHelpBox] || { box: openHelpBox, label: `Official CT600 box ${openHelpBox}`, type: "money", source: "manual" }} selected={!!values[openHelpBox]} /></div>
      ) : null}
    </div>
  );
}

function CompaniesHouseSectionOptions({ sections = [], values = {}, setValues, customSections = [], setCustomSections, onSave, disabled, compact = false }) {
  const addCustomSection = () => {
    const id = `custom_${Date.now()}`;
    setCustomSections((current) => [...current, { id, title: "New accounts section", content: "", enabled: true, custom: true }]);
  };
  const updateCustomSection = (id, changes) => {
    setCustomSections((current) => current.map((section) => section.id === id ? { ...section, ...changes } : section));
  };
  const removeCustomSection = (id) => {
    setCustomSections((current) => current.filter((section) => section.id !== id));
  };
  return (
    <Panel title="Companies House accounts contents">
      <p className="mb-3 text-sm text-stone-600">Required statutory sections remain fixed. Optional sections can be selected, and additional narrative sections can be created and edited for the accounts preview.</p>
      <div className={compact ? "grid gap-2" : "grid gap-2 md:grid-cols-2 xl:grid-cols-3"}>
        {sections.map((section) => (
          <label key={section.id} className="flex items-center gap-3 rounded-md border border-stone-200 p-3 text-sm">
            <input
              type="checkbox"
              checked={section.required ? true : !!values[section.id]}
              disabled={disabled || section.required}
              onChange={(event) => setValues((current) => ({ ...current, [section.id]: event.target.checked }))}
            />
            <span><span className="font-medium">{section.label}</span>{section.required ? <span className="block text-xs text-stone-500">Required</span> : <span className="block text-xs text-stone-500">Optional</span>}</span>
          </label>
        ))}
      </div>
      <div className="mt-5 border-t border-stone-200 pt-4">
        <div className={compact ? "flex flex-col items-stretch gap-3" : "flex items-center justify-between gap-3"}>
          <div><h4 className="font-semibold text-stone-900">Additional sections</h4><p className="text-xs text-stone-500">Add narrative disclosures or schedules. Their filing eligibility will still be checked during iXBRL validation.</p></div>
          <Button type="button" variant="outline" onClick={addCustomSection} disabled={disabled}><Plus className="mr-2 h-4 w-4" />Add another section</Button>
        </div>
        <div className="mt-3 space-y-3">
          {customSections.map((section) => (
            <div key={section.id} className="rounded-md border border-stone-200 bg-stone-50 p-3">
              <div className={compact ? "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2" : "flex items-center gap-3"}>
                <input type="checkbox" checked={section.enabled !== false} disabled={disabled} onChange={(event) => updateCustomSection(section.id, { enabled: event.target.checked })} />
                <Input value={section.title || ""} disabled={disabled} onChange={(event) => updateCustomSection(section.id, { title: event.target.value })} placeholder="Section title" className="h-9 flex-1 bg-white" />
                <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => removeCustomSection(section.id)} aria-label={`Remove ${section.title || "custom section"}`}><Trash2 className="h-4 w-4" /></Button>
              </div>
              <textarea value={section.content || ""} disabled={disabled} onChange={(event) => updateCustomSection(section.id, { content: event.target.value })} placeholder="Enter the narrative or disclosure for this section" className="mt-3 min-h-28 w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm" />
            </div>
          ))}
          {!customSections.length ? <p className="rounded-md border border-dashed border-stone-300 py-6 text-center text-sm text-stone-500">No additional sections have been added.</p> : null}
        </div>
      </div>
      <div className={`mt-4 flex ${compact ? "justify-stretch" : "justify-end"}`}><Button type="button" className={compact ? "w-full" : ""} onClick={onSave} disabled={disabled}>Save Companies House contents</Button></div>
    </Panel>
  );
}

function RetiredCt600OverlayPreview({ preview = {}, form = {}, values = {}, autoValues = {}, setValues, disabled, onSave, onRefresh, onReset }) {
  const [layout, setLayout] = useState(null);
  const [layoutError, setLayoutError] = useState("");
  const [helpField, setHelpField] = useState(null);
  useEffect(() => {
    let active = true;
    fetch("/ct600-2026-v3/layout.json")
      .then((response) => {
        if (!response.ok) throw new Error("The CT600 form layout could not be loaded.");
        return response.json();
      })
      .then((result) => { if (active) setLayout(result); })
      .catch((error) => { if (active) setLayoutError(error.message); });
    return () => { active = false; };
  }, []);
  const fieldByBox = useMemo(() => Object.fromEntries(
    (form.sections || []).flatMap((section) => (section.fields || []).map((field) => [String(field.box), field]))
  ), [form.sections]);
  const automaticBoxes = useMemo(() => new Set(Object.keys(autoValues || {}).map(String)), [autoValues]);
  const update = (box, value) => setValues((current) => ({ ...current, [box]: value }));
  const percent = (value, total) => `${(Number(value || 0) / Number(total || 1)) * 100}%`;
  return (
    <section className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
      <div className="sticky top-0 z-20 border-b-4 border-emerald-700 bg-emerald-50 px-6 py-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-emerald-800">HM Revenue &amp; Customs</div>
            <div className="mt-1 flex flex-wrap items-end gap-3"><h3 className="text-xl font-bold text-slate-950">{preview.title || "Company Tax Return"}</h3><div className="text-sm font-semibold text-slate-700">{form.version || "CT600 (2026) Version 3"}</div></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={disabled} onClick={onReset}>Reset to automatic</Button>
            <Button type="button" variant="outline" disabled={disabled} onClick={onSave}>Save changes</Button>
            <Button type="button" disabled={disabled} onClick={onRefresh} style={{ background: "var(--brand)" }}>Refresh &amp; recalculate</Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
          <span><span className="mr-1 inline-block h-3 w-3 rounded border border-slate-400 bg-slate-200 align-middle"></span>Automatically populated and locked</span>
          <span><span className="mr-1 inline-block h-3 w-3 rounded border border-emerald-500 bg-white align-middle"></span>Manual field</span>
          <span>Click any blue box number for guidance.</span>
        </div>
      </div>
      <div className="space-y-6 bg-slate-200 p-3 md:p-6">
        {layout?.pages?.length ? layout.pages.map((page) => {
          const widgetGroups = Object.values((page.widgets || []).reduce((groups, widget) => {
            if (!widget.box) return groups;
            const current = groups[widget.box] || { box: widget.box, widgets: [] };
            current.widgets.push(widget);
            groups[widget.box] = current;
            return groups;
          }, {}));
          return (
            <div key={page.page} className="relative mx-auto w-full max-w-5xl overflow-hidden bg-white shadow-md" style={{ aspectRatio: `${page.width}/${page.height}` }}>
              <img src={`/ct600-2026-v3/page-${String(page.page).padStart(2, "0")}.png`} alt={`CT600 page ${page.page}`} className="absolute inset-0 h-full w-full select-none" draggable="false" />
              {(page.labels || []).map((label, index) => {
                const field = fieldByBox[String(label.box)] || { box: String(label.box), label: `Official CT600 box ${label.box}`, type: "text", source: "manual" };
                return (
                  <button
                    key={`${label.box}-${index}`}
                    type="button"
                    title={`Help for box ${label.box}`}
                    onClick={() => setHelpField(field)}
                    className="absolute z-10 rounded-sm border border-blue-600 bg-blue-600/15 text-[0px] ring-offset-1 hover:bg-blue-500/30 hover:ring-2 hover:ring-blue-500"
                    style={{ left: percent(label.x - 2, page.width), top: percent(label.top - 2, page.height), width: percent(Math.max(label.width + 5, 17), page.width), height: percent(Math.max(label.height + 4, 15), page.height) }}
                  >Box {label.box} help</button>
                );
              })}
              {widgetGroups.map((group) => {
                const field = fieldByBox[String(group.box)] || { box: String(group.box), label: `Official CT600 box ${group.box}`, type: "text", source: "manual" };
                const left = Math.min(...group.widgets.map((widget) => widget.x));
                const top = Math.min(...group.widgets.map((widget) => widget.top));
                const right = Math.max(...group.widgets.map((widget) => widget.x + widget.width));
                const bottom = Math.max(...group.widgets.map((widget) => widget.top + widget.height));
                const automatic = automaticBoxes.has(String(group.box));
                const isBoolean = field.type === "boolean" || group.widgets.every((widget) => widget.name.includes("_check_"));
                const commonStyle = { left: percent(left, page.width), top: percent(top, page.height), width: percent(right - left, page.width), height: percent(bottom - top, page.height) };
                if (isBoolean) {
                  return (
                    <button key={`input-${group.box}`} type="button" aria-disabled={disabled || automatic} onClick={() => { if (!disabled && !automatic) update(group.box, !values[group.box]); }} onContextMenu={(event) => { event.preventDefault(); setHelpField(field); }} aria-label={`Box ${group.box} - ${field.label}`} className={`absolute z-[5] flex items-center justify-center border text-sm font-bold ${automatic || disabled ? "cursor-not-allowed border-slate-400 bg-slate-300/75 text-slate-700" : "border-emerald-600 bg-white/80 text-slate-950 hover:bg-emerald-50"}`} style={commonStyle}>
                      {values[group.box] ? "X" : ""}
                    </button>
                  );
                }
                return (
                  <input
                    key={`input-${group.box}`}
                    aria-label={`Box ${group.box} - ${field.label}`}
                    value={values[group.box] ?? ""}
                    readOnly={automatic || disabled}
                    onChange={(event) => update(group.box, event.target.value)}
                    onContextMenu={(event) => { event.preventDefault(); setHelpField(field); }}
                    className={`absolute z-[5] border px-1 text-right font-mono text-[clamp(7px,1vw,12px)] outline-none ${automatic ? "cursor-not-allowed border-slate-400 bg-slate-300/80 text-slate-700" : "border-emerald-500 bg-white/85 text-slate-950 focus:ring-2 focus:ring-emerald-500"}`}
                    style={commonStyle}
                  />
                );
              })}
            </div>
          );
        }) : layoutError ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-5 text-center text-sm text-red-800">{layoutError}</div>
        ) : (
          <p className="py-12 text-center text-sm text-slate-600">Loading the interactive CT600 form...</p>
        )}
      </div>
      {helpField ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-label={`Guidance for box ${helpField.box}`} onMouseDown={(event) => { if (event.target === event.currentTarget) setHelpField(null); }}>
          <div className="w-full max-w-xl rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4"><div><div className="text-xs font-bold uppercase tracking-wide text-emerald-700">CT600 guidance</div><h4 className="mt-1 text-lg font-bold text-slate-950">Box {helpField.box} — {helpField.label}</h4></div><button type="button" onClick={() => setHelpField(null)} className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Close guidance">×</button></div>
            <Ct600BoxHelp field={helpField} selected={!!values[helpField.box]} />
            <div className="mt-4 flex justify-end"><Button type="button" onClick={() => setHelpField(null)}>Close</Button></div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Ct600PdfJsPageOne({ pdfUrl, values, automaticBoxes, setValues, disabled }) {
  const canvasRef = useRef(null);
  const [pageModel, setPageModel] = useState(null);
  const [widgetValues, setWidgetValues] = useState({});
  const [activeGuidance, setActiveGuidance] = useState(null);
  const [viewerError, setViewerError] = useState("");
  useEffect(() => {
    if (!pdfUrl) return undefined;
    let active = true;
    let loadingTask;
    (async () => {
      try {
        setViewerError("");
        const pdfjs = await import("pdfjs-dist/webpack.mjs");
        loadingTask = pdfjs.getDocument(pdfUrl);
        const document = await loadingTask.promise;
        const page = await document.getPage(1);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = canvasRef.current;
        if (!canvas || !active) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({
          canvasContext: canvas.getContext("2d"),
          viewport,
          annotationMode: pdfjs.AnnotationMode.DISABLE,
        }).promise;
        const annotations = (await page.getAnnotations({ intent: "display" }))
          .filter((annotation) => annotation.subtype === "Widget")
          .map((annotation) => {
            const guidance = String(annotation.alternativeText || annotation.contentsObj?.str || annotation.contents || "");
            const match = guidance.match(/^Box\s+(\d+)/i);
            const rectangle = viewport.convertToViewportRectangle(annotation.rect);
            return {
              ...annotation,
              box: match?.[1] || "",
              guidance,
              left: Math.min(rectangle[0], rectangle[2]),
              top: Math.min(rectangle[1], rectangle[3]),
              width: Math.abs(rectangle[2] - rectangle[0]),
              height: Math.abs(rectangle[3] - rectangle[1]),
            };
          });
        if (!active) return;
        setPageModel({ width: viewport.width, height: viewport.height, annotations });
        setWidgetValues(Object.fromEntries(annotations.map((annotation) => [
          annotation.id,
          annotation.fieldValue === null || annotation.fieldValue === undefined ? "" : String(annotation.fieldValue),
        ])));
      } catch (loadError) {
        if (active) setViewerError(loadError?.message || "The interactive CT600 page could not be loaded.");
      }
    })();
    return () => {
      active = false;
      if (loadingTask) loadingTask.destroy();
    };
  }, [pdfUrl]);
  const automatic = useMemo(() => new Set((automaticBoxes || []).map(String)), [automaticBoxes]);
  const updateTextWidget = (annotation, nextValue) => {
    setWidgetValues((current) => {
      const next = { ...current, [annotation.id]: nextValue };
      if (annotation.box) {
        const group = (pageModel?.annotations || [])
          .filter((candidate) => candidate.box === annotation.box && candidate.fieldType === "Tx")
          .sort((left, right) => left.left - right.left);
        const combined = group.map((candidate) => next[candidate.id] || "").join("");
        setValues((currentValues) => ({ ...currentValues, [annotation.box]: combined }));
      }
      return next;
    });
  };
  if (viewerError) return <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">{viewerError}</div>;
  return (
    <div className={`grid items-start gap-4 ${activeGuidance ? "xl:grid-cols-[minmax(0,1fr)_22rem]" : ""}`}>
      <div className="overflow-auto rounded border border-slate-300 bg-slate-200 p-2">
        <div className="relative mx-auto bg-white shadow-sm" style={{ width: pageModel?.width || 893, height: pageModel?.height || 1263 }}>
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
          {(pageModel?.annotations || []).map((annotation) => {
            const box = String(annotation.box || "");
            const isAutomatic = automatic.has(box);
            const isCheckbox = annotation.fieldType === "Btn" && annotation.checkBox;
            const style = { left: annotation.left, top: annotation.top, width: annotation.width, height: annotation.height };
            const common = {
              title: annotation.guidance || `CT600 field ${annotation.fieldName}`,
              onMouseEnter: () => setActiveGuidance(annotation),
              onFocus: () => setActiveGuidance(annotation),
              onContextMenu: (event) => { event.preventDefault(); setActiveGuidance(annotation); },
            };
            if (isCheckbox) {
              return (
                <button
                  key={annotation.id}
                  type="button"
                  {...common}
                  aria-label={annotation.guidance || annotation.fieldName}
                  aria-disabled={disabled || isAutomatic}
                  onClick={() => {
                    if (!disabled && !isAutomatic && box) {
                      setValues((current) => ({ ...current, [box]: !current[box] }));
                    }
                  }}
                  className={`absolute flex items-center justify-center border text-sm font-bold ${isAutomatic || disabled ? "cursor-not-allowed border-slate-400 bg-slate-200/90 text-slate-700" : "border-emerald-500 bg-white/90 text-black hover:bg-emerald-50"}`}
                  style={style}
                >{values[box] ? "X" : ""}</button>
              );
            }
            return (
              <input
                key={annotation.id}
                {...common}
                aria-label={annotation.guidance || annotation.fieldName}
                value={widgetValues[annotation.id] ?? ""}
                readOnly={disabled || isAutomatic}
                maxLength={annotation.maxLen || undefined}
                onChange={(event) => updateTextWidget(annotation, event.target.value)}
                className={`absolute border px-0.5 text-center font-mono text-[11px] outline-none ${isAutomatic || disabled ? "cursor-not-allowed border-slate-300 bg-slate-200/90 text-slate-700" : "border-emerald-500 bg-white/90 text-black focus:ring-2 focus:ring-emerald-500"}`}
                style={style}
              />
            );
          })}
          {!pageModel ? <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-600">Rendering interactive CT600 page 1…</div> : null}
        </div>
      </div>
      {activeGuidance ? (
        <aside className="h-fit rounded-lg border border-blue-200 bg-white p-4 shadow-sm xl:sticky xl:top-4">
          <div className="text-xs font-bold uppercase tracking-wide text-emerald-700">Line-level guidance</div>
          <h4 className="mt-1 font-bold text-slate-950">{activeGuidance.box ? `Box ${activeGuidance.box}` : activeGuidance.fieldName}</h4>
          <p className="mt-2 text-sm leading-relaxed text-slate-700">{activeGuidance.guidance || "No mapped guidance is available for this widget yet."}</p>
          <p className="mt-3 text-xs text-slate-500">Hover, focus or right-click another field to update this guidance. Each visible control is the original individual PDF widget.</p>
        </aside>
      ) : null}
    </div>
  );
}

function RetiredInteractiveCt600Preview({ preview = {}, form = {}, pdfUrl = "", loading = false, error = "", values = {}, automaticBoxes = [], setValues, disabled, onRefresh, onReset, onRetry }) {
  const [viewerMode, setViewerMode] = useState("interactive");
  const [guidanceBox, setGuidanceBox] = useState("");
  const guidanceFields = useMemo(() => (
    (form.sections || []).flatMap((section) => section.fields || [])
  ), [form.sections]);
  const selectedGuidanceField = guidanceFields.find((field) => String(field.box) === String(guidanceBox));
  return (
    <section className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
      <div className="border-b-4 border-emerald-700 bg-emerald-50 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-emerald-800">HM Revenue &amp; Customs</div>
            <div className="mt-1 flex flex-wrap items-end gap-3"><h3 className="text-xl font-bold text-slate-950">{preview.title || "Company Tax Return"}</h3><div className="text-sm font-semibold text-slate-700">{form.version || "CT600 (2026) Version 3"}</div></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setViewerMode((current) => current === "interactive" ? "native" : "interactive")}>{viewerMode === "interactive" ? "View full native PDF" : "Try interactive page 1"}</Button>
            <Button type="button" variant="outline" disabled={disabled} onClick={onReset}>Reset to automatic</Button>
            <Button type="button" disabled={disabled} onClick={onRefresh} style={{ background: "var(--brand)" }}>Refresh &amp; recalculate</Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-600">This is the native fillable HMRC form. Values stay in place until you explicitly refresh or reset them.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor="ct600-box-guidance" className="text-xs font-semibold text-slate-700">Box guidance</label>
          <select id="ct600-box-guidance" value={guidanceBox} onChange={(event) => setGuidanceBox(event.target.value)} className="h-9 min-w-[19rem] max-w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800">
            <option value="">Select a CT600 box for an explanation</option>
            {guidanceFields.map((field) => <option key={field.box} value={field.box}>Box {field.box} — {field.label}</option>)}
          </select>
          {guidanceBox ? <Button type="button" size="sm" variant="outline" onClick={() => setGuidanceBox("")}>Clear guidance</Button> : null}
        </div>
      </div>
      <div className={`grid gap-4 bg-slate-100 p-4 md:p-6 ${selectedGuidanceField ? "xl:grid-cols-[minmax(0,1fr)_22rem]" : ""}`}>
        {pdfUrl && viewerMode === "interactive" ? (
          <Ct600PdfJsPageOne pdfUrl={pdfUrl} values={values} automaticBoxes={automaticBoxes} setValues={setValues} disabled={disabled} />
        ) : pdfUrl ? (
          <iframe title="Populated CT600 preview" src={`${pdfUrl}#toolbar=1&navpanes=0&view=FitH`} className="mx-auto h-[78vh] min-h-[720px] w-full max-w-5xl border-0 bg-white shadow-sm" />
        ) : error ? (
          <div className="mx-auto max-w-xl rounded-md border border-red-200 bg-red-50 p-5 text-center text-sm text-red-800">
            <p>{error}</p>
            <Button type="button" variant="outline" className="mt-3" onClick={onRetry}>Retry CT600 preview</Button>
          </div>
        ) : (
          <p className="py-12 text-center text-sm text-slate-600">{loading ? "Preparing the populated fillable CT600 PDF..." : "Open this Preview tab to load the populated CT600 form."}</p>
        )}
        {selectedGuidanceField ? (
          <aside className="h-fit rounded-lg border border-blue-200 bg-white p-4 shadow-sm xl:sticky xl:top-4">
            <div className="text-xs font-bold uppercase tracking-wide text-emerald-700">CT600 field guidance</div>
            <h4 className="mt-1 font-bold text-slate-950">Box {selectedGuidanceField.box}</h4>
            <p className="text-sm text-slate-700">{selectedGuidanceField.label}</p>
            <Ct600BoxHelp field={selectedGuidanceField} selected={false} />
            <p className="mt-3 text-xs text-slate-500">Enter or mark the value directly in the native form. This panel does not change or reload the PDF.</p>
          </aside>
        ) : null}
      </div>
    </section>
  );
}

function ExactCt600SubmissionPreview({ preview = {}, form = {}, pdfUrl = "", loading = false, error = "", onRetry }) {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
      <header className="border-b-4 border-emerald-700 bg-emerald-50 px-6 py-4">
        <div className="text-xs font-bold uppercase tracking-widest text-emerald-800">HM Revenue &amp; Customs</div>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3"><h3 className="text-2xl font-bold text-slate-950">{preview.title || "Company Tax Return"}</h3><div className="font-semibold text-slate-700">{form.version || "CT600 (2026) Version 3"}</div></div>
        <p className="mt-2 text-sm text-slate-600">Read-only preview of the populated official HMRC CT600 form. Make changes in Details &amp; sections.</p>
      </header>
      <div className="bg-slate-100 p-4 md:p-6">
        {pdfUrl ? (
          <iframe title="Read-only populated CT600 preview" src={`${pdfUrl}#toolbar=1&navpanes=0&view=FitH`} className="mx-auto h-[78vh] min-h-[720px] w-full max-w-5xl border-0 bg-white shadow-sm" />
        ) : error ? (
          <div className="mx-auto max-w-xl rounded-md border border-red-200 bg-red-50 p-5 text-center text-sm text-red-800"><p>{error}</p><Button type="button" variant="outline" className="mt-3" onClick={onRetry}>Retry CT600 preview</Button></div>
        ) : (
          <p className="py-12 text-center text-sm text-slate-600">{loading ? "Preparing the read-only CT600 preview…" : "Open this Preview tab to load the populated form."}</p>
        )}
      </div>
    </section>
  );
}

function Ct600SubmissionPreview({ preview = {}, form = {}, values = {} }) {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
      <div className="border-b-4 border-emerald-700 bg-emerald-50 px-6 py-5">
        <div className="text-xs font-bold uppercase tracking-widest text-emerald-800">HM Revenue & Customs</div>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <h3 className="text-2xl font-bold text-slate-950">{preview.title || "Company Tax Return"}</h3>
          <div className="font-semibold text-slate-700">{preview.form || "CT600"}</div>
        </div>
        <p className="mt-2 text-sm text-slate-600">{preview.notice}</p>
      </div>
      <div className="space-y-6 bg-slate-100 p-4 md:p-6">
        {(form.sections || []).map((section, pageIndex) => (
          <div key={section.id} className="mx-auto min-h-[720px] max-w-5xl bg-white p-6 shadow-sm md:p-10">
            <div className="mb-6 flex items-start justify-between border-b-2 border-emerald-700 pb-3">
              <div><div className="text-xs font-bold text-emerald-800">Company Tax Return</div><h4 className="mt-1 font-bold text-slate-950">{section.title}</h4></div>
              <div className="text-right text-xs text-slate-500">{form.version}<br />Preview page {pageIndex + 1} of {(form.sections || []).length}</div>
            </div>
            <div className="grid gap-x-5 gap-y-3 md:grid-cols-2">
              {(section.fields || []).map((field) => (
                <div key={`${section.id}-${field.box}`} className="grid grid-cols-[3.5rem_1fr] gap-3 border-b border-slate-200 pb-3">
                  <div className="h-fit rounded bg-emerald-700 px-2 py-1 text-center text-xs font-bold text-white">{field.box}</div>
                  <div>
                    <div className="text-xs text-slate-700">{field.label}</div>
                    <div className="mt-1 min-h-8 rounded border border-slate-300 bg-slate-50 px-2 py-1.5 text-right font-mono text-sm">
                      {field.type === "boolean" ? (values[field.box] ? "X" : "") : (values[field.box] ?? "") || "—"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CompaniesHouseAccountsPages({ preview = {} }) {
  const approval = preview.approval || {};
  const enabled = new Set((preview.section_options || []).filter((item) => item.enabled).map((item) => item.id));
  const company = String(preview.title || "Company").toUpperCase();
  const periodEnd = preview.period_to ? formatDate(preview.period_to) : "period end not entered";
  const currentYear = preview.current_year || String(preview.period_to || "").slice(0, 4) || "Current";
  const comparativeYear = preview.comparative_year || "Comparative";
  const director = approval.director || "Director not selected";
  const jurisdiction = preview.jurisdiction || "England and Wales";
  const notes = preview.notes || [];
  const customSections = (preview.custom_sections || []).filter((section) => section.enabled !== false);
  const pageClass = "relative mx-auto min-h-[72rem] w-full max-w-[51rem] bg-white px-10 pb-16 pt-10 text-[13px] leading-[1.35] text-black shadow-sm sm:px-12";
  const Heading = ({ title, subtitle = `FOR THE YEAR ENDED ${String(periodEnd).toUpperCase()}` }) => (
    <header className="mb-10 whitespace-pre-line border-b border-black pb-4 text-center text-[18px] font-bold uppercase leading-tight">
      <div>{company}</div><div>{title}</div>{subtitle ? <div>{subtitle}</div> : null}
    </header>
  );
  const Footer = ({ page }) => <div className="absolute inset-x-12 bottom-6 border-t border-black pt-2 text-center">- {page} -</div>;
  const displayAmount = (value) => {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return "-";
    const rendered = Math.abs(number).toLocaleString("en-GB", { maximumFractionDigits: 0 });
    return number < 0 ? `(${rendered})` : rendered;
  };
  const Statement = ({ rows = [], showNotes = false }) => (
    <table className="w-full border-collapse">
      <thead><tr><th className="pb-4 text-left"></th>{showNotes ? <th className="w-14 pb-4 text-center">Notes</th> : null}<th className="w-28 pb-4 text-right">{currentYear}<br />£</th><th className="w-28 pb-4 text-right">{comparativeYear}<br />£</th></tr></thead>
      <tbody>{rows.map((row, index) => {
        const total = /gross|operating|before tax|before taxation|financial year|net assets|shareholders|capital and reserves|total assets/i.test(row.label || "");
        return <tr key={`${row.label}-${index}`} className={total ? "font-bold" : ""}><td className="py-1 pr-3">{row.label}</td>{showNotes ? <td className="py-1 text-center">{row.note || ""}</td> : null}<td className={`py-1 text-right tabular-nums ${total ? "border-b border-black" : ""}`}>{displayAmount(row.amount)}</td><td className={`py-1 text-right tabular-nums ${total ? "border-b border-black" : ""}`}>{displayAmount(row.comparative)}</td></tr>;
      })}</tbody>
    </table>
  );
  const Note = ({ note }) => <div className="grid grid-cols-[1.5rem_1fr] gap-2"><div className="font-bold">{note.number}</div><div><h5 className="font-bold">{note.title}</h5><p className="mt-3">{note.body}</p></div></div>;

  return (
    <section className="space-y-5 rounded-lg bg-slate-200 p-3 sm:p-6">
      <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Accounts-production preview. This page layout follows the statutory accounts format; filing validity remains subject to iXBRL and Companies House validation.</div>
      {enabled.has("cover") && <article className={pageClass}><div className="text-center font-bold">Company Registration No. {preview.company_number || "not entered"} ({jurisdiction})</div><div className="mt-[25rem] text-center text-[18px] font-bold uppercase leading-tight"><div>{company}</div><div>ANNUAL REPORT AND UNAUDITED ACCOUNTS</div><div>FOR THE YEAR ENDED {String(periodEnd).toUpperCase()}</div></div></article>}
      {enabled.has("contents") && <article className={pageClass}><Heading title="ANNUAL REPORT AND UNAUDITED ACCOUNTS" subtitle="CONTENTS" /><table className="mx-auto mt-12 w-3/4"><thead><tr><th></th><th className="text-right">Page</th></tr></thead><tbody>{[["Company information", 3], ["Director's report", 4], ["Income statement", 5], ["Statement of financial position", 6], ["Notes to the accounts", 7], ["Detailed profit and loss account", 10]].map(([label, page]) => <tr key={label}><td className="py-1">{label}</td><td className="text-right">{page}</td></tr>)}</tbody></table><Footer page={2} /></article>}
      {enabled.has("company_information") && <article className={pageClass}><Heading title="COMPANY INFORMATION" /><dl className="mx-auto mt-12 grid w-4/5 grid-cols-[10rem_1fr] gap-y-5"><dt className="font-bold">Director</dt><dd>{(preview.directors || []).join(", ") || director}</dd><dt className="font-bold">Company Number</dt><dd>{preview.company_number || "-"} ({jurisdiction})</dd><dt className="font-bold">Registered Office</dt><dd className="whitespace-pre-line">{preview.registered_office || "-"}</dd><dt className="font-bold">Accountants</dt><dd className="whitespace-pre-line">{preview.accountants || "-"}</dd></dl><Footer page={3} /></article>}
      {enabled.has("directors_report") && <article className={pageClass}><Heading title={`(COMPANY NO: ${preview.company_number || "-"} ${jurisdiction.toUpperCase()})\nDIRECTOR'S REPORT`} subtitle="" /><div className="space-y-5"><p>The director presents the report and accounts for the year ended {periodEnd}.</p><div><h5 className="font-bold">Directors</h5><p>{director} held office during the whole of the period.</p></div><div><h5 className="font-bold">Statement of directors' responsibilities</h5><p>The directors are responsible for preparing the report and accounts in accordance with applicable law and regulations.</p></div><p>Company law requires the directors to prepare accounts for each financial year. The directors must not approve the accounts unless satisfied that they give a true and fair view of the company and its profit or loss for the period.</p><ul className="list-inside list-disc"><li>select suitable accounting policies and apply them consistently;</li><li>make judgements and estimates that are reasonable and prudent;</li><li>prepare the accounts on the going concern basis unless inappropriate.</li></ul><p>The directors are responsible for adequate accounting records, safeguarding the company's assets, and taking reasonable steps for preventing and detecting fraud and other irregularities.</p><div><h5 className="font-bold">Small company provisions</h5><p>This report has been prepared in accordance with the special provisions relating to small companies within Part 15 of the Companies Act 2006.</p></div><div className="pt-4"><p>Signed on behalf of the board of directors</p><div className="my-6 w-80 border-b border-dotted border-black"></div><p>{director}<br />Director</p><p className="mt-4">Approved by the board on: {approval.date ? formatDate(approval.date) : "not entered"}</p></div></div><Footer page={4} /></article>}
      {enabled.has("profit_and_loss") && <article className={pageClass}><Heading title="INCOME STATEMENT" /><Statement rows={preview.profit_and_loss_rows || []} /><Footer page={5} /></article>}
      {enabled.has("balance_sheet") && <article className={pageClass}><Heading title="STATEMENT OF FINANCIAL POSITION" subtitle={`AS AT ${String(periodEnd).toUpperCase()}`} /><Statement rows={preview.balance_sheet_rows || []} showNotes /><div className="mt-5 space-y-4"><p>{approval.audit_basis || "Audit exemption or auditor report basis has not been selected."}</p><p>The director acknowledges responsibility for complying with the requirements of the Companies Act 2006 with respect to accounting records and the preparation of accounts.</p><p>These accounts have been prepared under the small companies' regime and {preview.accounts_standard || "the selected accounting standard"}.</p><p>The financial statements were approved by the Board and authorised for issue on {approval.date ? formatDate(approval.date) : "not entered"} and were signed on its behalf by</p><p>{director}<br />Director</p><p>Company Registration No. {preview.company_number || "-"}</p></div><Footer page={6} /></article>}
      {!!notes.length && <article className={pageClass}><Heading title="NOTES TO THE ACCOUNTS" /><div className="space-y-7">{notes.slice(0, 3).map((note) => <Note key={note.number} note={note} />)}<div className="ml-8 space-y-4"><div><h6 className="font-bold italic">Basis of preparation</h6><p>The accounts have been prepared under the historical cost convention.</p></div><div><h6 className="font-bold italic">Presentation currency</h6><p>The accounts are presented in £ sterling.</p></div><div><h6 className="font-bold italic">Turnover</h6><p>Turnover is measured at the fair value of consideration received or receivable, excluding discounts, rebates, VAT and other sales taxes.</p></div><div><h6 className="font-bold italic">Tangible fixed assets and depreciation</h6><p>Tangible assets are included at cost less depreciation and impairment.</p></div></div></div><Footer page={7} /></article>}
      {notes.length > 3 && <article className={pageClass}><div className="space-y-8">{notes.slice(3, 7).map((note) => <Note key={note.number} note={note} />)}</div><Footer page={8} /></article>}
      {notes.length > 7 && <article className={pageClass}><Heading title="NOTES TO THE ACCOUNTS" /><Note note={notes[7]} /><Footer page={9} /></article>}
      {customSections.map((section, index) => (
        <article key={section.id} className={pageClass}>
          <Heading title={String(section.title || "ADDITIONAL SECTION").toUpperCase()} />
          <div className="whitespace-pre-line text-justify leading-relaxed">{section.content || "No narrative has been entered for this section."}</div>
          <Footer page={10 + index} />
        </article>
      ))}
      {enabled.has("detailed_profit_and_loss") && <article className={pageClass}><Heading title="DETAILED PROFIT AND LOSS ACCOUNT" /><p className="-mt-8 mb-6 text-center">This schedule does not form part of the statutory accounts.</p><Statement rows={(preview.detailed_profit_and_loss_rows || []).map((row) => ({ ...row, comparative: row.comparative || 0 }))} /><Footer page={10} /></article>}
    </section>
  );
}

function CompaniesHouseSubmissionPreview({ preview = {} }) {
  const approval = preview.approval || {};
  const enabled = new Set((preview.section_options || []).filter((section) => section.enabled).map((section) => section.id));
  return (
    <section className="mx-auto max-w-5xl overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
      <div className="border-b border-slate-300 px-8 py-10 text-center">
        <div className="text-xs font-bold uppercase tracking-[0.25em] text-blue-800">Companies House filing preview</div>
        <h3 className="mt-5 text-2xl font-bold uppercase text-slate-950">{preview.title || "Company"}</h3>
        <p className="mt-2 text-sm text-slate-600">Company number {preview.company_number || "—"}</p>
        <p className="mt-8 text-lg font-semibold text-slate-800">{preview.period_label}</p>
        <p className="mt-2 text-sm text-slate-500">{preview.accounts_standard} · {preview.accounts_format}</p>
      </div>
      <div className="space-y-8 px-8 py-8">
        {enabled.has("contents") ? <div><h4 className="border-b-2 border-slate-800 pb-2 text-lg font-bold">Contents</h4><ReportTable rows={(preview.section_options || []).filter((section) => section.enabled).map((section, index) => ({ section: section.label, page: index + 1 }))} columns={[["section", "Section"], ["page", "Page"]]} compact /></div> : null}
        {enabled.has("company_information") ? <div><h4 className="border-b-2 border-slate-800 pb-2 text-lg font-bold">Company information</h4><div className="mt-3 grid gap-3 md:grid-cols-2"><Info label="Director" value={(preview.directors || []).join(", ") || "—"} /><Info label="Company number" value={preview.company_number || "—"} /><Info label="Registered office" value={preview.registered_office || "—"} /><Info label="Accountants" value={preview.accountants || "—"} /></div></div> : null}
        {enabled.has("directors_report") ? <div><h4 className="border-b-2 border-slate-800 pb-2 text-lg font-bold">Director's report</h4><p className="mt-3 text-sm text-slate-700">The director presents the report and accounts for the period shown above. The report is approved by the board and signed on its behalf by {approval.director || "the selected director"}.</p></div> : null}
        {enabled.has("profit_and_loss") ? <div>
          <h4 className="border-b-2 border-slate-800 pb-2 text-lg font-bold">Profit and loss account</h4>
          <ReportTable rows={preview.profit_and_loss_rows || []} columns={[["label", "Line"], ["amount", "Current year", "money"], ["comparative", "Comparative", "money"]]} compact />
        </div> : null}
        {enabled.has("balance_sheet") ? <div>
          <h4 className="border-b-2 border-slate-800 pb-2 text-lg font-bold">Balance sheet</h4>
          <ReportTable rows={preview.balance_sheet_rows || []} columns={[["label", "Line"], ["amount", "Current year", "money"], ["comparative", "Comparative", "money"]]} compact />
        </div> : null}
        {(preview.notes || []).length ? <div><h4 className="border-b-2 border-slate-800 pb-2 text-lg font-bold">Notes to the accounts</h4><div className="mt-3 space-y-4">{preview.notes.map((note) => <div key={note.number}><div className="font-semibold text-slate-900">{note.number}. {note.title}</div><p className="mt-1 text-sm text-slate-700">{note.body}</p></div>)}</div></div> : null}
        {enabled.has("detailed_profit_and_loss") ? <div><h4 className="border-b-2 border-slate-800 pb-2 text-lg font-bold">Detailed profit and loss account</h4><ReportTable rows={preview.detailed_profit_and_loss_rows || []} columns={[["label", "Nominal account"], ["amount", "Current year", "money"]]} compact /></div> : null}
        <div className="rounded border border-slate-300 p-5 text-sm text-slate-700">
          <div className="font-bold text-slate-900">Approval and signature</div>
          <p className="mt-2">{approval.audit_basis || "Audit exemption or auditor-report basis not yet selected."}</p>
          <p className="mt-3">Approved by the board and authorised for issue on <strong>{approval.date ? formatDate(approval.date) : "—"}</strong>.</p>
          <p className="mt-3 border-t border-slate-200 pt-3">Signed on behalf of the board by <strong>{approval.director || "—"}</strong>, Director.</p>
        </div>
      </div>
    </section>
  );
}

function VatAdjustmentDoubleEntryPreview({ form = {} }) {
  const amount = Math.abs(Number(form.vat_amount || 0));
  const debitVat = ["decrease_output", "increase_input"].includes(form.direction) || (form.direction === "net_adjustment" && Number(form.vat_amount || 0) > 0);
  const lines = amount > 0 ? [
    { account: debitVat ? "VAT control account" : "VAT adjustment / suspense", debit: amount, credit: 0 },
    { account: debitVat ? "VAT adjustment / suspense" : "VAT control account", debit: 0, credit: amount },
  ] : [];
  return (
    <section className="overflow-hidden rounded-lg border border-stone-300 bg-white">
      <div className="border-b border-stone-200 bg-stone-100 px-4 py-3">
        <h4 className="font-display font-bold text-stone-900">Double-entry preview</h4>
        <p className="text-xs text-stone-600">The configured native VAT control and suspense accounts are resolved when the adjustment is posted.</p>
      </div>
      {lines.length ? <table className="min-w-full text-sm"><thead className="bg-stone-50 text-left text-xs uppercase text-stone-500"><tr><th className="px-4 py-2">Account</th><th className="px-4 py-2 text-right">Debit</th><th className="px-4 py-2 text-right">Credit</th></tr></thead><tbody>{lines.map((line) => <tr key={`${line.account}-${line.debit}`} className="border-t border-stone-100"><td className="px-4 py-2 font-medium">{line.account}</td><td className="px-4 py-2 text-right">{line.debit ? formatMoney(line.debit) : "-"}</td><td className="px-4 py-2 text-right">{line.credit ? formatMoney(line.credit) : "-"}</td></tr>)}</tbody><tfoot className="border-t-2 border-stone-300 bg-stone-50 font-bold"><tr><td className="px-4 py-2 text-right">Totals</td><td className="px-4 py-2 text-right">{formatMoney(amount)}</td><td className="px-4 py-2 text-right">{formatMoney(amount)}</td></tr></tfoot></table> : <p className="p-4 text-sm text-stone-500">Select a direction and enter a VAT amount to preview the posting.</p>}
    </section>
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

function AuditTrailWorkspace({ clientId }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [data, setData] = useState(() => normalisePaginatedResponse({ page_size: DEFAULT_PAGE_SIZE }));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setPage(1); }, [search, action, pageSize]);
  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (search) params.set("search", search);
    if (action) params.set("action", action);
    setLoading(true); setError("");
    api.get(`/admin/accounting/clients/${clientId}/audit-trail?${params.toString()}`)
      .then(({ data: response }) => { if (!cancelled) setData(normalisePaginatedResponse(response, pageSize)); })
      .catch((requestError) => { if (!cancelled) setError(formatApiError(requestError)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId, page, pageSize, search, action]);
  const auditLog = data.rows;
  return (
    <Panel title="Audit trail">
      <div className="mb-3 flex flex-wrap gap-2"><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search audit trail" className="h-9 max-w-lg" /><Input value={action} onChange={(event) => setAction(event.target.value)} placeholder="Filter action" className="h-9 max-w-xs" /></div>
      {error ? <p className="py-8 text-center text-sm text-red-700">{error}</p> : loading && !auditLog.length ? <p className="py-8 text-center text-sm text-stone-500">Loading audit trail...</p> : auditLog.length === 0 ? (
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
      <PaginationFooter page={data.page} pageSize={data.page_size} totalRows={data.total_rows} totalPages={data.total_pages} onPageChange={setPage} onPageSizeChange={setPageSize} disabled={loading} />
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

function LocationsSettingsWorkspace({ clientId }) {
  const emptyForm = { id: "", code: "", name: "", description: "", status: "active", is_default: false };
  const [data, setData] = useState({ rows: [] });
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!clientId) return;
    try {
      const { data: response } = await api.get(`/admin/accounting/clients/${clientId}/locations?page=1&page_size=250`);
      setData(normalisePaginatedResponse(response));
    } catch (error) {
      toast.error(formatApiError(error, "Locations could not be loaded."));
    }
  }, [clientId]);
  useEffect(() => { load(); }, [load]);
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (form.id) await api.patch(`/admin/accounting/clients/${clientId}/locations/${form.id}`, form);
      else await api.post(`/admin/accounting/clients/${clientId}/locations`, form);
      toast.success(`Location ${form.id ? "updated" : "created"}.`);
      setForm(emptyForm);
      await load();
    } catch (error) {
      toast.error(formatApiError(error, "Location could not be saved."));
    } finally { setBusy(false); }
  };
  const remove = async (row) => {
    if (!window.confirm(`Delete location ${row.code} - ${row.name}? Used locations can only be made inactive.`)) return;
    try {
      await api.delete(`/admin/accounting/clients/${clientId}/locations/${row.id}`);
      setForm(emptyForm);
      await load();
    } catch (error) { toast.error(formatApiError(error, "Location could not be deleted.")); }
  };
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
      <Panel title="Locations">
        <p className="mb-3 text-sm text-stone-500">Locations answer “Where did this happen?” and remain independent from management dimensions.</p>
        <div className="overflow-auto rounded-md border border-stone-200">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs uppercase text-stone-500"><tr><th className="px-3 py-2">Code</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Default</th><th className="px-3 py-2" /></tr></thead>
            <tbody>{data.rows.map((row) => <tr key={row.id} className="border-t border-stone-100">
              <td className="px-3 py-2 font-semibold">{row.code}</td><td className="px-3 py-2">{row.name}</td><td className="px-3 py-2 capitalize">{row.status}</td><td className="px-3 py-2">{row.is_default ? "Yes" : "—"}</td>
              <td className="space-x-2 px-3 py-2 text-right"><Button type="button" size="sm" variant="outline" onClick={() => setForm({ ...emptyForm, ...row })}>Edit</Button><Button type="button" size="sm" variant="outline" onClick={() => remove(row)}>Delete</Button></td>
            </tr>)}</tbody>
          </table>
        </div>
      </Panel>
      <Panel title={form.id ? "Edit location" : "Add location"}>
        <form onSubmit={save} className="space-y-3">
          <Field label="Code" value={form.code} onChange={(value) => setForm((current) => ({ ...current, code: value }))} />
          <Field label="Name" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
          <Field label="Description" value={form.description} onChange={(value) => setForm((current) => ({ ...current, description: value }))} />
          <SelectField label="Status" value={form.status} onChange={(value) => setForm((current) => ({ ...current, status: value }))} options={[["active", "Active"], ["inactive", "Inactive"]]} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_default} onChange={(e) => setForm((current) => ({ ...current, is_default: e.target.checked }))} /> Default location</label>
          <div className="flex gap-2"><Button disabled={busy} className="flex-1" style={{ background: "var(--brand)" }}>Save location</Button>{form.id ? <Button type="button" variant="outline" onClick={() => setForm(emptyForm)}>Cancel</Button> : null}</div>
        </form>
      </Panel>
    </div>
  );
}

function DimensionsSettingsWorkspace({ clientId }) {
  const emptyType = { id: "", name: "", description: "", status: "active", sort_order: 0 };
  const emptyValue = { id: "", dimension_type_id: "", code: "", name: "", description: "", status: "active", is_default: false };
  const [types, setTypes] = useState([]);
  const [dimensions, setDimensions] = useState([]);
  const [typeForm, setTypeForm] = useState(emptyType);
  const [valueForm, setValueForm] = useState(emptyValue);
  const load = useCallback(async () => {
    if (!clientId) return;
    try {
      const [typeResponse, valueResponse] = await Promise.all([
        api.get(`/admin/accounting/clients/${clientId}/dimension-types`),
        api.get(`/admin/accounting/clients/${clientId}/dimensions?page=1&page_size=250`),
      ]);
      setTypes(normalisePaginatedResponse(typeResponse.data).rows);
      setDimensions(normalisePaginatedResponse(valueResponse.data).rows);
    } catch (error) { toast.error(formatApiError(error, "Dimensions could not be loaded.")); }
  }, [clientId]);
  useEffect(() => { load(); }, [load]);
  const saveType = async (event) => {
    event.preventDefault();
    try {
      if (typeForm.id) await api.patch(`/admin/accounting/clients/${clientId}/dimension-types/${typeForm.id}`, typeForm);
      else await api.post(`/admin/accounting/clients/${clientId}/dimension-types`, typeForm);
      setTypeForm(emptyType); await load();
    } catch (error) { toast.error(formatApiError(error, "Dimension type could not be saved.")); }
  };
  const saveValue = async (event) => {
    event.preventDefault();
    try {
      if (valueForm.id) await api.patch(`/admin/accounting/clients/${clientId}/dimensions/${valueForm.id}`, valueForm);
      else await api.post(`/admin/accounting/clients/${clientId}/dimensions`, valueForm);
      setValueForm(emptyValue); await load();
    } catch (error) { toast.error(formatApiError(error, "Dimension could not be saved.")); }
  };
  const remove = async (row) => {
    if (!window.confirm(`Delete dimension ${row.code} - ${row.name}? Used dimensions can only be made inactive.`)) return;
    try { await api.delete(`/admin/accounting/clients/${clientId}/dimensions/${row.id}`); await load(); }
    catch (error) { toast.error(formatApiError(error, "Dimension could not be deleted.")); }
  };
  return (
    <div className="space-y-4">
      <Panel title="Dimension types">
        <form onSubmit={saveType} className="grid gap-3 md:grid-cols-[1fr_2fr_140px_auto]">
          <Field label="Type name" value={typeForm.name} onChange={(value) => setTypeForm((current) => ({ ...current, name: value }))} />
          <Field label="Description" value={typeForm.description} onChange={(value) => setTypeForm((current) => ({ ...current, description: value }))} />
          <SelectField label="Status" value={typeForm.status} onChange={(value) => setTypeForm((current) => ({ ...current, status: value }))} options={[["active", "Active"], ["inactive", "Inactive"]]} />
          <Button className="mt-5" style={{ background: "var(--brand)" }}>Save type</Button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">{types.map((row) => <button type="button" key={row.id} onClick={() => setTypeForm({ ...emptyType, ...row })} className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm text-emerald-900">{row.name}</button>)}</div>
      </Panel>
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Panel title="Dimension values">
          <p className="mb-3 text-sm text-stone-500">Dimensions answer “What management reporting category does this belong to?”</p>
          <div className="overflow-auto rounded-md border border-stone-200"><table className="min-w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs uppercase text-stone-500"><tr><th className="px-3 py-2">Type</th><th className="px-3 py-2">Code</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Status</th><th className="px-3 py-2" /></tr></thead>
            <tbody>{dimensions.map((row) => <tr key={row.id} className="border-t border-stone-100"><td className="px-3 py-2">{row.dimension_type_name}</td><td className="px-3 py-2 font-semibold">{row.code}</td><td className="px-3 py-2">{row.name}</td><td className="px-3 py-2 capitalize">{row.status}</td><td className="space-x-2 px-3 py-2 text-right"><Button size="sm" variant="outline" onClick={() => setValueForm({ ...emptyValue, ...row })}>Edit</Button><Button size="sm" variant="outline" onClick={() => remove(row)}>Delete</Button></td></tr>)}</tbody>
          </table></div>
        </Panel>
        <Panel title={valueForm.id ? "Edit dimension" : "Add dimension"}>
          <form onSubmit={saveValue} className="space-y-3">
            <SelectField label="Dimension type" value={valueForm.dimension_type_id} onChange={(value) => setValueForm((current) => ({ ...current, dimension_type_id: value }))} options={types.filter((row) => row.status === "active" || row.id === valueForm.dimension_type_id).map((row) => [row.id, row.name])} />
            <Field label="Code" value={valueForm.code} onChange={(value) => setValueForm((current) => ({ ...current, code: value }))} />
            <Field label="Name" value={valueForm.name} onChange={(value) => setValueForm((current) => ({ ...current, name: value }))} />
            <Field label="Description" value={valueForm.description} onChange={(value) => setValueForm((current) => ({ ...current, description: value }))} />
            <SelectField label="Status" value={valueForm.status} onChange={(value) => setValueForm((current) => ({ ...current, status: value }))} options={[["active", "Active"], ["inactive", "Inactive"]]} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={valueForm.is_default} onChange={(e) => setValueForm((current) => ({ ...current, is_default: e.target.checked }))} /> Default dimension</label>
            <div className="flex gap-2"><Button className="flex-1" style={{ background: "var(--brand)" }}>Save dimension</Button>{valueForm.id ? <Button type="button" variant="outline" onClick={() => setValueForm(emptyValue)}>Cancel</Button> : null}</div>
          </form>
        </Panel>
      </div>
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

function ChartOfAccounts({ accounts, clientId, form, setForm, createAccount, updateAccount, deleteAccount, busy, drawerMode, selectedAccount, backendMessage, openEditAccount, closeDrawer }) {
  const [filters, setFilters] = useState({ category: "", account_type: "", purpose: "", module: "", filing_status: "", active: "active", search: "" });
  const [selectedAccountCodes, setSelectedAccountCodes] = useState([]);
  const [drawerTab, setDrawerTab] = useState("General");
  const [bankAccountRows, setBankAccountRows] = useState([]);
  const [accountHistory, setAccountHistory] = useState([]);
  const [allHistory, setAllHistory] = useState([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [historyTotalRows, setHistoryTotalRows] = useState(0);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyMessage, setHistoryMessage] = useState("");
  const [historyFilters, setHistoryFilters] = useState({ search: "", action: "", user: "", date_from: "", date_to: "", status: "" });
  const accountRows = accounts || [];
  const isEditing = drawerMode === "edit";
  const isHistoryView = drawerMode === "history";
  const protectedAccount = isEditing && isProtectedAccount(selectedAccount);
  const bankCompatible = isBankCompatibleAccount(form);
  const duplicateCode = drawerMode === "add" && !!form.code && accountRows.some((account) => String(account.code || "").trim().toLowerCase() === form.code.trim().toLowerCase());

  const loadBankAccountRows = useCallback(async () => {
    if (!clientId) {
      setBankAccountRows([]);
      return;
    }
    try {
      const { data } = await api.get(`/admin/accounting/clients/${clientId}/banking/accounts?page=1&page_size=250`);
      const paged = normalisePaginatedResponse(data, 250);
      const rows = paged.rows.length ? paged.rows : (Array.isArray(data?.bank_accounts) ? data.bank_accounts : Array.isArray(data?.accounts) ? data.accounts : []);
      setBankAccountRows(rows);
    } catch {
      setBankAccountRows([]);
    }
  }, [clientId]);

  useEffect(() => { loadBankAccountRows(); }, [loadBankAccountRows]);

  const bankMetadataByCode = useMemo(() => {
    const rows = new Map();
    bankAccountRows.forEach((row) => {
      const code = String(row.nominal_account_code || row.account_code || row.code || "").trim();
      if (code) rows.set(code, row);
    });
    return rows;
  }, [bankAccountRows]);

  const selectedBankMetadata = selectedAccount ? bankMetadataByCode.get(String(selectedAccount.code || selectedAccount.account_code || "").trim()) : null;
  const selectedEditorAccount = selectedAccount && selectedBankMetadata ? { ...selectedAccount, bank_metadata: selectedBankMetadata } : selectedAccount;

  const loadAccountHistory = useCallback(async () => {
    if (!clientId || !selectedAccount?.code) return;
    setHistoryLoading(true);
    setHistoryMessage("");
    try {
      const params = new URLSearchParams({ page: String(historyPage), page_size: String(historyPageSize) });
      if (historyFilters.search) params.set("search", historyFilters.search);
      if (historyFilters.action) params.set("action", historyFilters.action);
      if (historyFilters.user) params.set("user", historyFilters.user);
      if (historyFilters.date_from) params.set("date_from", historyFilters.date_from);
      if (historyFilters.date_to) params.set("date_to", historyFilters.date_to);
      const { data } = await api.get(`/admin/accounting/clients/${clientId}/chart-of-accounts/${encodeURIComponent(selectedAccount.code)}/history?${params.toString()}`);
      const paged = normalisePaginatedResponse(data, historyPageSize);
      setAccountHistory(paged.rows);
      setHistoryTotalRows(paged.total_rows);
      setHistoryTotalPages(paged.total_pages);
    } catch (e) {
      const status = e?.response?.status || e?.status;
      if ([404, 405, 501].includes(status)) {
        setHistoryMessage("Backend endpoint required: Chart of Accounts audit history.");
      } else {
        setHistoryMessage(formatApiError(e));
      }
      setAccountHistory([]);
      setHistoryTotalRows(0);
      setHistoryTotalPages(1);
    } finally {
      setHistoryLoading(false);
    }
  }, [clientId, selectedAccount?.code, historyPage, historyPageSize, historyFilters.search, historyFilters.action, historyFilters.user, historyFilters.date_from, historyFilters.date_to]);

  const loadAllHistory = useCallback(async () => {
    setAllHistory([]);
    setHistoryMessage("Select a nominal account and open its History tab to load paginated history.");
  }, []);

  useEffect(() => {
    setDrawerTab("General");
    setHistoryMessage("");
    setAccountHistory([]);
    setHistoryPage(1);
  }, [drawerMode, selectedAccount?.id, selectedAccount?.code]);

  useEffect(() => {
    if (drawerMode !== "edit" || !selectedAccount) return;
    setForm((current) => mergeBankMetadataIntoForm(current, selectedBankMetadata));
  }, [
    drawerMode,
    selectedAccount,
    selectedBankMetadata,
    setForm,
  ]);

  useEffect(() => { setHistoryPage(1); }, [historyPageSize, historyFilters.search, historyFilters.action, historyFilters.user, historyFilters.date_from, historyFilters.date_to]);

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
    if (filters.module && account.module !== filters.module) return false;
    if (filters.filing_status && account.filing_status !== filters.filing_status) return false;
    if (filters.active === "active" && account.active === false) return false;
    if (filters.active === "inactive" && account.active !== false) return false;
    const needle = filters.search.trim().toLowerCase();
    if (needle && !`${account.code || ""} ${account.name || ""} ${account.account_type || ""} ${account.purpose || ""} ${account.module || ""} ${account.internal_reporting_category || ""} ${account.statutory_presentation || ""}`.toLowerCase().includes(needle)) return false;
    return true;
  });
  const selectedAccounts = visibleAccounts.filter((account) => selectedAccountCodes.includes(String(account.code)));
  const allVisibleSelected = visibleAccounts.length > 0 && selectedAccounts.length === visibleAccounts.length;

  return (
    <div className={drawerMode && drawerMode !== "edit" ? "grid gap-4 xl:grid-cols-[1fr_380px]" : "space-y-4"}>
      <Panel title="Chart of accounts">
        <div className="mb-3 grid gap-2 md:grid-cols-3 xl:grid-cols-7">
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
          <select value={filters.module} onChange={(e) => setFilters((current) => ({ ...current, module: e.target.value }))} className="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm">
            <option value="">All modules</option>
            {COA_MODULES.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select value={filters.filing_status} onChange={(e) => setFilters((current) => ({ ...current, filing_status: e.target.value }))} className="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm">
            <option value="">All filing statuses</option>
            {COA_FILING_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
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
        {selectedAccounts.length ? (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-stone-200 bg-stone-50 px-3 py-2">
            <span className="text-sm font-semibold text-stone-700">{selectedAccounts.length} account{selectedAccounts.length === 1 ? "" : "s"} selected</span>
            <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => downloadReportCsv("chart-of-accounts.csv", selectedAccounts)}>
              <Download className="h-4 w-4" /> Export selected
            </Button>
          </div>
        ) : null}
        <div className="overflow-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all visible accounts"
                    checked={allVisibleSelected}
                    onChange={(event) => setSelectedAccountCodes(event.target.checked ? visibleAccounts.map((account) => String(account.code)) : [])}
                  />
                </th>
                <th className="px-3 py-2">Account Code</th>
                <th className="px-3 py-2">Account Name</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Account Type</th>
                <th className="px-3 py-2">Purpose</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Module</th>
                <th className="px-3 py-2">Reporting category</th>
                <th className="px-3 py-2">Filing status</th>
                <th className="px-3 py-2">Banking</th>
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
                      onClick={() => selected ? closeDrawer() : openEditAccount(account)}
                      className={`cursor-pointer border-t border-stone-100 hover:bg-emerald-50/40 ${selected ? "border-l-4 border-l-emerald-700 bg-emerald-50/80 shadow-[inset_0_0_0_1px_rgba(4,120,87,0.16)] hover:bg-emerald-50" : "border-l-4 border-l-transparent"}`}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Select ${account.code} ${account.name}`}
                          checked={selectedAccountCodes.includes(String(account.code))}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => setSelectedAccountCodes((current) => event.target.checked ? [...current, String(account.code)] : current.filter((code) => code !== String(account.code)))}
                        />
                      </td>
                      <td className={`px-3 py-2 font-semibold text-stone-900 ${selected ? "font-bold" : ""}`}>{account.code}</td>
                      <td className={`px-3 py-2 ${selected ? "font-semibold text-stone-900" : ""}`}>{account.name}</td>
                      <td className="px-3 py-2 text-stone-600">{account.category}</td>
                      <td className="px-3 py-2 text-stone-600">{account.account_type || account.type}</td>
                      <td className="px-3 py-2 text-stone-600">{account.purpose || "Standard Nominal"}</td>
                      <td className="px-3 py-2"><Badge variant="outline">{accountStatementLabel(account)}</Badge></td>
                      <td className="px-3 py-2 text-stone-600">{account.module || "CORE"}</td>
                      <td className="px-3 py-2 text-stone-600">{account.internal_reporting_category || "-"}</td>
                      <td className="px-3 py-2"><Badge variant="outline">{account.filing_status || "Ready"}</Badge></td>
                      <td className="px-3 py-2">{account.show_in_banking || account.banking_enabled ? <Badge className="bg-emerald-100 text-emerald-800">Shown in Banking</Badge> : <span className="text-stone-400">Not applicable</span>}</td>
                      <td className="px-3 py-2">{account.active === false ? <Badge className="bg-stone-100 text-stone-700">Inactive</Badge> : <Badge className="bg-emerald-100 text-emerald-800">Active</Badge>}</td>
                      <td className="px-3 py-2 text-right font-semibold">{formatMoney(account.current_balance)}</td>
                    </tr>
                    {selected ? (
                      <tr className="border-t border-emerald-200 bg-emerald-50/30">
                        <td colSpan="13" className="p-3">
                          <AccountEditorContent
                            account={selectedEditorAccount}
                            form={form}
                            setForm={setForm}
                            updateAccount={updateAccount}
                            deleteAccount={deleteAccount}
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
                            historyFilters={historyFilters}
                            setHistoryFilters={setHistoryFilters}
                            historyPage={historyPage}
                            historyPageSize={historyPageSize}
                            historyTotalRows={historyTotalRows}
                            historyTotalPages={historyTotalPages}
                            setHistoryPage={setHistoryPage}
                            setHistoryPageSize={setHistoryPageSize}
                            closeDrawer={closeDrawer}
                            bankMetadata={selectedBankMetadata}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
              {!visibleAccounts.length ? (
                <tr>
                  <td colSpan="13" className="px-3 py-10 text-center text-stone-500">No accounts match the current filters.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>
      {drawerMode === "add" ? (
        <div className="fixed inset-x-3 bottom-3 top-3 z-40 overflow-y-auto rounded-md bg-white shadow-2xl xl:sticky xl:inset-auto xl:top-4 xl:z-auto xl:max-h-[calc(100vh-2rem)] xl:self-start xl:shadow-none">
        <Panel title="Add account">
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
                <AccountHistoryPanel account={selectedAccount} protectedAccount={protectedAccount} history={accountHistory} loading={historyLoading} message={historyMessage} filters={historyFilters} setFilters={setHistoryFilters} closeDrawer={closeDrawer} page={historyPage} pageSize={historyPageSize} totalRows={historyTotalRows} totalPages={historyTotalPages} setPage={setHistoryPage} setPageSize={setHistoryPageSize} />
              ) : (
                <form onSubmit={isEditing ? updateAccount : createAccount} className="space-y-3">
                  {protectedAccount ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      This Balance Sheet account is used by accounting modules. Only its opening balance and applicable banking settings can be changed.
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
                  <AccountDrawerField label="Opening balance" type="number" value={form.opening_balance} onChange={(value) => setForm((current) => ({ ...current, opening_balance: value }))} />
                  {String(form.account_type || "").toLowerCase() === "bank" ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <AccountDrawerField label="Bank name" value={form.bank_name} onChange={(value) => setForm((current) => ({ ...current, bank_name: value }))} />
                      <AccountDrawerField label="Bank account ref" value={form.account_number} onChange={(value) => setForm((current) => ({ ...current, account_number: value }))} />
                    </div>
                  ) : null}
                  {bankCompatible ? <label className="block rounded-md border border-stone-200 p-3 text-sm text-stone-700">
                    <span className="flex items-center gap-2 font-semibold">
                      <input type="checkbox" checked={!!(form.show_in_banking || form.banking_enabled)} onChange={(e) => setShowInBanking(e.target.checked)} />
                      Show in Banking
                    </span>
                    <span className="mt-1 block text-xs font-normal text-stone-500">
                      {bankCompatible ? "Use this for actual bank, cash, card, Stripe, PayPal, or clearing accounts that need statement import and reconciliation." : "Only bank, cash, card, payment, or clearing accounts can appear in Banking."}
                    </span>
                  </label> : null}
                  <label className="flex items-center gap-2 rounded-md border border-stone-200 p-3 text-sm font-semibold text-stone-700">
                    <input type="checkbox" checked={form.active !== false} disabled={protectedAccount && accountHasPostings(selectedAccount)} onChange={(e) => setForm((current) => ({ ...current, active: e.target.checked }))} />
                    Active
                  </label>
                  {protectedAccount && accountHasPostings(selectedAccount) ? <p className="text-xs text-stone-500">This account has postings or is required by a core module, so it cannot be deactivated here.</p> : null}
                  <AccountDrawerField label="Description" value={form.description} onChange={(value) => setForm((current) => ({ ...current, description: value }))} />
                  <AccountMappingFields form={form} setForm={setForm} />
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

function AccountEditorContent({ account, form, setForm, updateAccount, deleteAccount, busy, duplicateCode, protectedAccount, bankCompatible, backendMessage, drawerTab, setDrawerTab, setShowInBanking, accountHistory, historyLoading, historyMessage, historyFilters, setHistoryFilters, closeDrawer, historyPage, historyPageSize, historyTotalRows, historyTotalPages, setHistoryPage, setHistoryPageSize, bankMetadata }) {
  const [editMode, setEditMode] = useState(false);

  useEffect(() => {
    setEditMode(false);
  }, [account?.id, account?.code]);

  const structuralLocked = !editMode || protectedAccount;
  const safeLocked = !editMode;
  const bankingLocked = !editMode || !bankCompatible;
  const activeLocked = !editMode || (protectedAccount && accountHasPostings(account));

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
              This Balance Sheet account is used by accounting modules. Only its opening balance and applicable banking settings can be changed.
            </div>
          ) : null}
        </div>
        {drawerTab === "History" ? (
          <AccountHistoryPanel account={account} protectedAccount={protectedAccount} history={accountHistory} loading={historyLoading} message={historyMessage} filters={historyFilters} setFilters={setHistoryFilters} closeDrawer={closeDrawer} page={historyPage} pageSize={historyPageSize} totalRows={historyTotalRows} totalPages={historyTotalPages} setPage={setHistoryPage} setPageSize={setHistoryPageSize} />
        ) : (
          <form onSubmit={updateAccount} className="space-y-3">
            {!editMode ? (
              <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-600">
                This account is open in read-only mode. Select Edit to change supported fields.
              </div>
            ) : null}
            {backendMessage ? <InlineFormMessage message={backendMessage} /> : null}
            {duplicateCode ? <InlineFormMessage message="An account with this code already exists." tone="error" /> : null}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <AccountDrawerField label="Account code" value={form.code} disabled={structuralLocked} onChange={(value) => setForm((current) => ({ ...current, code: value }))} />
              <AccountDrawerField label="Account name" value={form.name} disabled={structuralLocked} onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
              <AccountDrawerSelect label="Category" value={form.category} options={ACCOUNT_CATEGORIES} disabled={structuralLocked} onChange={(value) => setForm((current) => ({ ...current, category: value }))} />
              <AccountDrawerSelect label="Account type" value={form.account_type} options={ACCOUNT_TYPES} disabled={structuralLocked} onChange={(value) => setForm((current) => ({ ...current, account_type: value }))} />
              <AccountDrawerSelect label="Purpose" value={form.purpose} options={ACCOUNT_PURPOSES} disabled={structuralLocked} onChange={(value) => setForm((current) => ({ ...current, purpose: value }))} />
              <AccountDrawerSelect label="Normal balance" value={form.normal_balance} options={[["debit", "Debit"], ["credit", "Credit"]]} disabled={structuralLocked} onChange={(value) => setForm((current) => ({ ...current, normal_balance: value }))} />
            </div>
            <OpeningBalanceSection
              account={account}
              form={form}
              setForm={setForm}
              bankCompatible={bankCompatible}
              bankMetadata={bankMetadata}
              disabled={!editMode}
            />
            <div className="grid gap-3 md:grid-cols-2">
              {bankCompatible ? <label className="block rounded-md border border-stone-200 p-3 text-sm text-stone-700">
                <span className="flex items-center gap-2 font-semibold">
                  <input type="checkbox" checked={!!(form.show_in_banking || form.banking_enabled)} disabled={bankingLocked} onChange={(e) => setShowInBanking(e.target.checked)} />
                  Show in Banking
                </span>
                <span className="mt-1 block text-xs font-normal text-stone-500">
                  {bankCompatible ? "Use this for bank, cash, card, Stripe, PayPal, or clearing accounts." : "Only bank, cash, card, payment, or clearing accounts can appear in Banking."}
                </span>
              </label> : null}
              <label className="flex items-center gap-2 rounded-md border border-stone-200 p-3 text-sm font-semibold text-stone-700">
                <input type="checkbox" checked={form.active !== false} disabled={activeLocked} onChange={(e) => setForm((current) => ({ ...current, active: e.target.checked }))} />
                Active
              </label>
            </div>
            {protectedAccount && accountHasPostings(account) ? <p className="text-xs text-stone-500">This account has postings or is required by a core module, so it cannot be deactivated here.</p> : null}
            <AccountDrawerField label="Description" value={form.description} disabled={protectedAccount ? true : safeLocked} onChange={(value) => setForm((current) => ({ ...current, description: value }))} />
            <AccountMappingFields form={form} setForm={setForm} disabled={safeLocked} />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={closeDrawer}>Cancel</Button>
              {!editMode ? <Button type="button" variant="outline" onClick={() => setEditMode(true)}>Edit</Button> : null}
              <Button disabled={!editMode || busy || duplicateCode} className="gap-2" style={{ background: "var(--brand)" }}>
                <Plus className="h-4 w-4" /> Save account
              </Button>
              {!protectedAccount ? (
                <Button type="button" variant="outline" disabled={!editMode || busy || form.active === false} onClick={() => setForm((current) => ({ ...current, active: false }))}>Make inactive</Button>
              ) : null}
              {account?.active === false && account?.can_delete ? <Button type="button" variant="destructive" disabled={busy} onClick={() => deleteAccount(account)}>Delete inactive nominal</Button> : null}
            </div>
            {account?.active === false && !account?.can_delete && account?.delete_block_reason ? <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{account.delete_block_reason}</div> : null}
          </form>
        )}
      </div>
    </div>
  );
}

function OpeningBalanceSection({ account, form, setForm, bankCompatible, bankMetadata, disabled }) {
  const hasBankMetadata = !!bankMetadata?.id;
  const bankAccountType = String(form.account_type || "").trim().toLowerCase() === "bank";
  return (
    <div className="rounded-md border border-stone-200 bg-stone-50 p-3">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-stone-900">Opening balance</div>
          <div className="text-xs text-stone-500">
            Opening balance is separate from the current posted balance shown in the Chart of Accounts list.
          </div>
        </div>
        <div className="text-right text-xs text-stone-500">
          <div>Current balance</div>
          <div className="text-sm font-bold text-stone-900">{formatMoney(account?.current_balance)}</div>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <AccountDrawerField
          label="Opening balance"
          type="number"
          value={form.opening_balance}
          disabled={disabled}
          onChange={(value) => setForm((current) => ({ ...current, opening_balance: value }))}
        />
        {bankAccountType ? <AccountDrawerField label="Currency" value={form.currency || "GBP"} disabled={disabled} onChange={(value) => setForm((current) => ({ ...current, currency: value }))} /> : null}
        {bankAccountType ? <AccountDrawerField label="Bank name" value={form.bank_name} disabled={disabled} onChange={(value) => setForm((current) => ({ ...current, bank_name: value }))} /> : null}
        {bankAccountType ? <AccountDrawerField label="Bank account ref" value={form.account_number} disabled={disabled} onChange={(value) => setForm((current) => ({ ...current, account_number: value }))} /> : null}
      </div>
      {bankAccountType && hasBankMetadata ? (
        <div className="mt-2 text-xs text-stone-500">Banking metadata found for nominal {bankMetadata.nominal_account_code || bankMetadata.code || account?.code || "-"}.</div>
      ) : bankAccountType ? (
        <div className="mt-2 text-xs text-amber-700">No Banking metadata record is available for this nominal account yet.</div>
      ) : null}
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
            <Badge variant="outline">{accountStatementLabel(account)}</Badge>
            {account?.show_in_banking || account?.banking_enabled ? <Badge className="bg-emerald-100 text-emerald-800">Banking</Badge> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function AccountHistoryPanel({ account, protectedAccount, history, loading, message, filters, setFilters, closeDrawer, page, pageSize, totalRows, totalPages, setPage, setPageSize }) {
  return (
    <div className="space-y-3">
      {protectedAccount ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Structural fields for this Balance Sheet account are protected because accounting modules depend on it. Its history remains available.
        </div>
      ) : null}
      <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2">
        <div className="text-sm font-semibold text-stone-900">{account?.code || "-"} - {account?.name || "Account"}</div>
        <div className="text-xs text-stone-500">Nominal account audit timeline</div>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
        <input value={filters.search} onChange={(e) => setFilters((current) => ({ ...current, search: e.target.value }))} placeholder="Search history" className="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm" />
        <input value={filters.action} onChange={(e) => setFilters((current) => ({ ...current, action: e.target.value }))} placeholder="Action" className="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm" />
        <input value={filters.user} onChange={(e) => setFilters((current) => ({ ...current, user: e.target.value }))} placeholder="User" className="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm" />
        <input type="date" value={filters.date_from} onChange={(e) => setFilters((current) => ({ ...current, date_from: e.target.value }))} aria-label="History from date" className="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm" />
        <input type="date" value={filters.date_to} onChange={(e) => setFilters((current) => ({ ...current, date_to: e.target.value }))} aria-label="History to date" className="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm" />
      </div>
      <HistoryTimeline history={history} loading={loading} message={message} />
      <PaginationFooter page={page} pageSize={pageSize} totalRows={totalRows} totalPages={totalPages} onPageChange={setPage} onPageSizeChange={setPageSize} disabled={loading} />
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
  if (accountStatementType(account) !== "balance_sheet") return false;
  const text = `${account?.purpose || ""} ${account?.account_type || account?.type || ""} ${account?.detail_type || ""} ${account?.name || ""}`.toLowerCase();
  return account?.purpose === "Bank Account" || text.includes("bank") || text.includes("cash") || text.includes("card") || text.includes("stripe") || text.includes("paypal") || text.includes("clearing") || text.includes("payment");
}

function accountStatementType(account = {}) {
  if (account.statement === "P&L") return "profit_and_loss";
  if (account.statement === "Balance Sheet") return "balance_sheet";
  if (account.statement === "Memorandum") return "memorandum";
  if (account.statement_type || account.statement_section) return account.statement_type || account.statement_section;
  return ["Income", "Other Income", "Expense", "Other Expense"].includes(account.category) ? "profit_and_loss" : "balance_sheet";
}

function accountStatementLabel(account = {}) {
  const statement = accountStatementType(account);
  return statement === "profit_and_loss" ? "P&L" : statement === "memorandum" ? "Memorandum" : "Balance Sheet";
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
  const bank = account.bank_metadata || account.bank_account || {};
  const openingBalance = account.opening_balance ?? account.bank_opening_balance ?? bank.opening_balance ?? "";
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
    is_control_account: !!(account.is_control_account || account.control_account || account.control),
    show_in_banking: !!(account.show_in_banking || account.banking_enabled),
    banking_enabled: !!(account.show_in_banking || account.banking_enabled),
    active: account.active !== false,
    description: account.description || "",
    master_account_id: account.master_account_id || "",
    module: account.module || "CORE",
    default_active: account.default_active || (account.active === false ? "Inactive" : "Active"),
    account_class: account.account_class || account.category || "Expense",
    account_subtype: account.account_subtype || account.account_type || account.type || "Overheads",
    statement: account.statement || (["Income", "Other Income", "Expense", "Other Expense"].includes(account.category) ? "P&L" : account.category === "Memorandum" ? "Memorandum" : "Balance Sheet"),
    control_account_type: account.control_account_type || "None",
    allow_manual_posting: account.allow_manual_posting !== false,
    system_account: !!account.system_account,
    reporting_category_id: account.reporting_category_id || "",
    internal_reporting_category: account.internal_reporting_category || "",
    statutory_presentation: account.statutory_presentation || "",
    cash_flow_category: account.cash_flow_category || "",
    default_tax_treatment: account.default_tax_treatment || "",
    vat_behaviour: account.vat_behaviour || "",
    cis_role: account.cis_role || "",
    requires_dimension: account.requires_dimension || "",
    current_noncurrent_rule: account.current_noncurrent_rule || "",
    filing_status: account.filing_status || "Ready",
    suggested_taxonomy_concept: account.suggested_taxonomy_concept || "",
    implementation_note: account.implementation_note || "",
    opening_balance: openingBalance,
    original_opening_balance: openingBalance,
    bank_account_id: account.bank_account_id || bank.id || "",
    bank_name: account.bank_name || bank.bank_name || "",
    account_number: account.account_number || bank.account_number || "",
    sort_code: account.sort_code || bank.sort_code || "",
    currency: account.currency || bank.currency || "GBP",
    allow_payments: account.allow_payments ?? bank.allow_payments ?? true,
    allow_receipts: account.allow_receipts ?? bank.allow_receipts ?? true,
  };
}

function mergeBankMetadataIntoForm(form, bankMetadata) {
  if (!bankMetadata) return form;
  const openingBalance = bankMetadata.opening_balance ?? form.opening_balance ?? "";
  return {
    ...form,
    opening_balance: form.opening_balance === "" || form.opening_balance === undefined ? openingBalance : form.opening_balance,
    original_opening_balance: openingBalance,
    bank_account_id: bankMetadata.id || form.bank_account_id || "",
    bank_name: bankMetadata.bank_name || form.bank_name || "",
    account_number: bankMetadata.account_number || form.account_number || "",
    sort_code: bankMetadata.sort_code || form.sort_code || "",
    currency: bankMetadata.currency || form.currency || "GBP",
    allow_payments: bankMetadata.allow_payments ?? form.allow_payments,
    allow_receipts: bankMetadata.allow_receipts ?? form.allow_receipts,
  };
}

function normaliseAmountForCompare(value) {
  if (value === null || value === undefined || value === "") return "";
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue.toFixed(2) : String(value).trim();
}

function accountOpeningBalanceChanged(form = {}) {
  return normaliseAmountForCompare(form.opening_balance) !== normaliseAmountForCompare(form.original_opening_balance);
}

function accountUpdatePayload(form = {}) {
  const payload = {
    code: form.code,
    name: form.name,
    category: form.category,
    account_type: form.account_type,
    purpose: form.purpose,
    normal_balance: form.normal_balance,
    is_control_account: form.is_control_account,
    show_in_banking: form.show_in_banking,
    banking_enabled: form.banking_enabled,
    active: form.active,
    description: form.description,
    master_account_id: form.master_account_id,
    module: form.module,
    default_active: form.default_active,
    account_class: form.account_class,
    account_subtype: form.account_subtype,
    statement: form.statement,
    control_account_type: form.control_account_type,
    allow_manual_posting: form.allow_manual_posting,
    system_account: form.system_account,
    reporting_category_id: form.reporting_category_id,
    internal_reporting_category: form.internal_reporting_category,
    statutory_presentation: form.statutory_presentation,
    cash_flow_category: form.cash_flow_category,
    default_tax_treatment: form.default_tax_treatment,
    vat_behaviour: form.vat_behaviour,
    cis_role: form.cis_role,
    requires_dimension: form.requires_dimension,
    current_noncurrent_rule: form.current_noncurrent_rule,
    filing_status: form.filing_status,
    suggested_taxonomy_concept: form.suggested_taxonomy_concept,
    implementation_note: form.implementation_note,
  };
  if (accountOpeningBalanceChanged(form)) payload.opening_balance = form.opening_balance;
  if (String(form.account_type || "").trim().toLowerCase() === "bank") {
    payload.bank_name = form.bank_name;
    payload.account_number = form.account_number;
    payload.sort_code = form.sort_code;
    payload.currency = form.currency;
  }
  return payload;
}

function AccountDrawerField({ label, value, onChange, disabled = false, type = "text" }) {
  return (
    <div>
      <Label className="text-xs font-semibold text-stone-600">{label}</Label>
      <Input type={type} value={value || ""} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="mt-1 h-9" />
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
        <button key={item.label} type="button" className="group flex min-h-[150px] flex-col rounded-xl border border-stone-200 bg-white p-4 text-left shadow-[0_3px_12px_rgba(28,25,23,0.06)] transition duration-150 hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-[0_10px_26px_rgba(6,78,59,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2">
          <span className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"><Sparkles className="h-4 w-4" /></span>
            <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">{item.module}</span>
          </span>
          <span className="mt-auto border-t border-stone-200 pt-3">
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-stone-500">{item.label}</span>
            <span className="mt-1 block truncate font-display text-xl font-bold text-emerald-800">{formatMaybeMoney(item.value)}</span>
          </span>
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

function reportQueryParams(filters, page, pageSize, extra = {}) {
  return glQueryParams(filters, page, pageSize, extra);
}

const REPORT_PERIOD_OPTIONS = [
  ["custom", "Custom date"],
  ["today", "Today"],
  ["this_month", "This month"],
  ["last_month", "Last month"],
  ["year_to_date", "Year to date"],
  ["last_year", "Last year"],
];

function localDateValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function reportPeriodDates(period, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "today") return [localDateValue(today), localDateValue(today)];
  if (period === "this_month") return [localDateValue(new Date(today.getFullYear(), today.getMonth(), 1)), localDateValue(today)];
  if (period === "last_month") {
    return [
      localDateValue(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
      localDateValue(new Date(today.getFullYear(), today.getMonth(), 0)),
    ];
  }
  if (period === "year_to_date") return [localDateValue(new Date(today.getFullYear(), 0, 1)), localDateValue(today)];
  if (period === "last_year") {
    return [
      localDateValue(new Date(today.getFullYear() - 1, 0, 1)),
      localDateValue(new Date(today.getFullYear() - 1, 11, 31)),
    ];
  }
  return ["", ""];
}

function ReportPeriodFilter({ filters, setFilters }) {
  const period = filters?.report_period || "custom";
  const invalidRange = !!(filters?.date_from && filters?.date_to && filters.date_from > filters.date_to);

  function selectPeriod(nextPeriod) {
    const [dateFrom, dateTo] = reportPeriodDates(nextPeriod);
    setFilters((current) => ({
      ...current,
      report_period: nextPeriod,
      ...(nextPeriod === "custom" ? {} : { date_from: dateFrom, date_to: dateTo }),
      financial_year_id: "",
      period_id: "",
    }));
  }

  function setCustomDate(field, value) {
    setFilters((current) => ({
      ...current,
      report_period: "custom",
      [field]: value,
      financial_year_id: "",
      period_id: "",
    }));
  }

  return (
    <section className="rounded-md border border-stone-200 bg-white p-4" aria-label="Report filters">
      <div className="grid gap-3 md:grid-cols-[minmax(190px,0.8fr)_minmax(160px,1fr)_minmax(160px,1fr)] md:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="report-period">Report period</Label>
          <select
            id="report-period"
            value={period}
            onChange={(event) => selectPeriod(event.target.value)}
            className="h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm"
          >
            {REPORT_PERIOD_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="report-date-from">From</Label>
          <Input
            id="report-date-from"
            type="date"
            value={filters?.date_from || ""}
            max={filters?.date_to || undefined}
            onChange={(event) => setCustomDate("date_from", event.target.value)}
            className="h-9"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="report-date-to">To</Label>
          <Input
            id="report-date-to"
            type="date"
            value={filters?.date_to || ""}
            min={filters?.date_from || undefined}
            onChange={(event) => setCustomDate("date_to", event.target.value)}
            className="h-9"
          />
        </div>
      </div>
      {invalidRange ? <p className="mt-2 text-xs font-semibold text-red-700">The From date must be on or before the To date.</p> : null}
    </section>
  );
}

function useReportPage(workspace, endpoint, filters, page, pageSize, extra = {}) {
  const [data, setData] = useState(() => normalisePaginatedResponse({ page_size: DEFAULT_PAGE_SIZE }));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const clientId = workspace?.client?.id;
  const requestParams = useMemo(() => reportQueryParams(filters, page, pageSize, extra).toString(), [extra, filters, page, pageSize]);
  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    setLoading(true); setError("");
    api.get(`/admin/accounting/clients/${clientId}/reports/${endpoint}?${requestParams}`)
      .then(({ data: response }) => { if (!cancelled) setData(normalisePaginatedResponse(response, pageSize)); })
      .catch((requestError) => { if (!cancelled) { setError(formatApiError(requestError)); setData(normalisePaginatedResponse({ page, page_size: pageSize })); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId, endpoint, page, pageSize, requestParams]);
  return { data, loading, error };
}

function PaginatedReportPanel({ workspace, endpoint, title, filters, columns, empty, extra = {} }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const extraKey = JSON.stringify(extra);
  useEffect(() => { setPage(1); }, [endpoint, extraKey, filters?.date_from, filters?.date_to, filters?.financial_year_id, filters?.period_id, filters?.search, filters?.location_id, filters?.dimension_id, filters?.group_by, pageSize]);
  const { data, loading, error } = useReportPage(workspace, endpoint, filters, page, pageSize, extra);
  return (
    <Panel title={title}>
      {error ? <p className="py-8 text-center text-sm text-red-700">{error}</p> : loading && !data.rows.length ? <p className="py-8 text-center text-sm text-stone-500">Loading report...</p> : <ReportTable rows={data.rows} columns={columns} empty={empty} />}
      <PaginationFooter page={data.page} pageSize={data.page_size} totalRows={data.total_rows} totalPages={data.total_pages} onPageChange={setPage} onPageSizeChange={setPageSize} disabled={loading} />
    </Panel>
  );
}

function VatLazyReport({ workspace, filters }) {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");
  const clientId = workspace?.client?.id;
  const summaryParams = useMemo(() => reportQueryParams(filters, 1, DEFAULT_PAGE_SIZE).toString(), [filters]);
  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    api.get(`/admin/accounting/clients/${clientId}/reports/vat/summary?${summaryParams}`)
      .then(({ data }) => { if (!cancelled) setSummary(data || {}); })
      .catch((requestError) => { if (!cancelled) setError(formatApiError(requestError)); });
    return () => { cancelled = true; };
  }, [clientId, summaryParams]);
  return <div className="space-y-4">{error ? <p className="text-sm text-red-700">{error}</p> : <div className="grid gap-3 sm:grid-cols-3"><SummaryCard label="Sales VAT" value={formatMoney(summary?.sales?.vat)} tone="blue" /><SummaryCard label="Purchase VAT" value={formatMoney(summary?.purchases?.vat)} tone="amber" /><SummaryCard label="Net VAT" value={formatMoney(summary?.net_vat)} tone="emerald" /></div>}<PaginatedReportPanel workspace={workspace} endpoint="vat/detail" title="VAT detail" filters={filters} columns={[["date", "Date", "date"], ["source_module", "Module"], ["document_number", "Document"], ["vat_code", "VAT code"], ["net", "Net", "money"], ["vat", "VAT", "money"], ["gross", "Gross", "money"]]} empty="No VAT transactions match the selected filters." /></div>;
}

function LazyReportsWorkspace({ workspace, activeReport, filters, setFilters }) {
  const reportName = activeReport || "Profit and Loss";
  let report;
  if (reportName === "Profit and Loss") report = <LazyFinancialStatements workspace={workspace} filters={filters} statement="profit_and_loss" />;
  else if (reportName === "Balance Sheet") report = <LazyFinancialStatements workspace={workspace} filters={filters} statement="balance_sheet" />;
  else if (reportName === "Trial Balance") report = <LazyTrialBalanceReport workspace={workspace} filters={filters} />;
  else if (reportName === "Management Reports") report = <LazyManagementReports workspace={workspace} filters={filters} />;
  else if (reportName === "VAT Reports") report = <VatLazyReport workspace={workspace} filters={filters} />;
  else if (reportName === "Sales Reports") report = <SalesLazyReports workspace={workspace} filters={filters} />;
  else if (reportName === "Purchase Reports") report = <PurchaseLazyReports workspace={workspace} filters={filters} />;
  else if (reportName === "Bank Reports") report = <PaginatedReportPanel workspace={workspace} endpoint="banking" title="Bank report" filters={filters} columns={[["transaction_date", "Date", "date"], ["description", "Description"], ["reference", "Reference"], ["money_in", "Money in", "money"], ["money_out", "Money out", "money"], ["status", "Status"]]} empty="No bank report rows found for the selected filters." />;
  else if (reportName === "Custom Reports") report = <LazyListReport workspace={workspace} endpoint="custom" title="Custom reports" filters={filters} columns={[["name", "Name"], ["type", "Type"], ["updated_at", "Updated", "date"]]} empty="No custom reports have been saved." />;
  else if (reportName === "Report Scheduler") report = <LazyListReport workspace={workspace} endpoint="scheduler" title="Scheduled reports" filters={filters} columns={[["name", "Report"], ["frequency", "Frequency"], ["next_run", "Next run", "date"], ["status", "Status"]]} empty="No scheduled reports have been configured." />;
  else if (reportName === "Exports") report = <LazyListReport workspace={workspace} endpoint="exports" title="Report exports" filters={filters} columns={[["created_at", "Created", "date"], ["report", "Report"], ["format", "Format"], ["status", "Status"]]} empty="No report exports have been generated." />;
  else if (reportName === "Settings") report = <LazyReportSettings workspace={workspace} filters={filters} />;
  else report = <LazyFinancialStatements workspace={workspace} filters={filters} statement="profit_and_loss" />;
  return <div className="space-y-4"><ReportPeriodFilter filters={filters} setFilters={setFilters} />{report}</div>;
}

function LazyTrialBalanceReport({ workspace, filters }) {
  const requestParams = glQueryParams(filters, 1, DEFAULT_PAGE_SIZE);
  requestParams.set("mode", "as_at");
  return (
    <LazyModuleWorkspace workspace={workspace} endpoint={`gl/trial-balance?${requestParams}`} field="reports">
      {(loaded) => <TrialBalanceReport workspace={loaded} filters={filters} />}
    </LazyModuleWorkspace>
  );
}

function AccountMappingFields({ form, setForm, disabled = false }) {
  const setValue = (field) => (value) => setForm((current) => ({ ...current, [field]: value }));
  return (
    <details open className="rounded-md border border-emerald-200 bg-emerald-50/30 p-3">
      <summary className="cursor-pointer text-sm font-bold text-emerald-900">Reporting and compliance mapping</summary>
      <p className="mt-1 text-xs text-stone-600">These Chart of Accounts fields are the authoritative mapping used by Trial Balance and downstream reporting.</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {form.master_account_id ? <AccountDrawerField label="Master account ID (lineage)" value={form.master_account_id} disabled /> : null}
        <AccountDrawerSelect label="Module" value={form.module} options={COA_MODULES} disabled={disabled} onChange={setValue("module")} />
        <AccountDrawerSelect label="Default active" value={form.default_active} options={["Active", "Inactive"]} disabled={disabled} onChange={setValue("default_active")} />
        <AccountDrawerSelect label="Account class" value={form.account_class} options={["Asset", "Liability", "Equity", "Income", "Expense", "Memorandum"]} disabled={disabled} onChange={setValue("account_class")} />
        <AccountDrawerField label="Account subtype" value={form.account_subtype} disabled={disabled} onChange={setValue("account_subtype")} />
        <AccountDrawerSelect label="Statement" value={form.statement} options={COA_STATEMENTS} disabled={disabled} onChange={setValue("statement")} />
        <AccountDrawerField label="Control account type" value={form.control_account_type} disabled={disabled} onChange={setValue("control_account_type")} />
        <AccountDrawerField label="Reporting category ID" value={form.reporting_category_id} disabled={disabled} onChange={setValue("reporting_category_id")} />
        <AccountDrawerField label="Internal reporting category" value={form.internal_reporting_category} disabled={disabled} onChange={setValue("internal_reporting_category")} />
        <AccountDrawerField label="Statutory presentation" value={form.statutory_presentation} disabled={disabled} onChange={setValue("statutory_presentation")} />
        <AccountDrawerSelect label="Cash-flow category" value={form.cash_flow_category} options={COA_CASH_FLOW_CATEGORIES} disabled={disabled} onChange={setValue("cash_flow_category")} />
        <AccountDrawerField label="Default tax treatment" value={form.default_tax_treatment} disabled={disabled} onChange={setValue("default_tax_treatment")} />
        <AccountDrawerField label="VAT behaviour" value={form.vat_behaviour} disabled={disabled} onChange={setValue("vat_behaviour")} />
        <AccountDrawerSelect label="CIS role" value={form.cis_role} options={COA_CIS_ROLES} disabled={disabled} onChange={setValue("cis_role")} />
        <AccountDrawerField label="Required dimensions" value={form.requires_dimension} disabled={disabled} onChange={setValue("requires_dimension")} />
        <AccountDrawerField label="Current/non-current rule" value={form.current_noncurrent_rule} disabled={disabled} onChange={setValue("current_noncurrent_rule")} />
        <AccountDrawerSelect label="Filing status" value={form.filing_status} options={COA_FILING_STATUSES} disabled={disabled} onChange={setValue("filing_status")} />
        <AccountDrawerField label="Suggested taxonomy concept" value={form.suggested_taxonomy_concept} disabled={disabled} onChange={setValue("suggested_taxonomy_concept")} />
        <AccountDrawerField label="Implementation note" value={form.implementation_note} disabled={disabled} onChange={setValue("implementation_note")} />
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <label className="flex items-center gap-2 rounded-md border border-stone-200 bg-white p-3 text-sm font-semibold text-stone-700">
          <input type="checkbox" checked={form.allow_manual_posting !== false} disabled={disabled} onChange={(event) => setValue("allow_manual_posting")(event.target.checked)} />
          Allow manual posting
        </label>
        <label className="flex items-center gap-2 rounded-md border border-stone-200 bg-white p-3 text-sm font-semibold text-stone-700">
          <input type="checkbox" checked={!!form.system_account} disabled={disabled} onChange={(event) => setValue("system_account")(event.target.checked)} />
          System account
        </label>
      </div>
      <p className="mt-2 text-xs text-amber-700">Suggested taxonomy concepts are preparatory mappings only; they are not final filing tags.</p>
    </details>
  );
}

function useReportResource(workspace, endpoint, filters) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const clientId = workspace?.client?.id;
  const requestParams = useMemo(() => reportQueryParams(filters, 1, DEFAULT_PAGE_SIZE).toString(), [filters]);
  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    setLoading(true); setError("");
    api.get(`/admin/accounting/clients/${clientId}/reports/${endpoint}?${requestParams}`)
      .then(({ data: response }) => { if (!cancelled) setData(response || {}); })
      .catch((requestError) => { if (!cancelled) { setError(formatApiError(requestError)); setData(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId, endpoint, requestParams]);
  return { data, loading, error };
}

function LazyFinancialStatements({ workspace, filters, statement }) {
  const endpoint = statement === "balance_sheet" ? "balance-sheet" : "profit-and-loss";
  const { data, loading, error } = useReportResource(workspace, endpoint, filters);
  if (error) return <ReportUnavailable message={error} />;
  if (loading && !data) return <ReportUnavailable message="Loading financial statements..." />;
  return <FinancialStatementsWorkspace workspace={workspace} reports={data || {}} filters={filters} statement={statement} />;
}

function LazyManagementReports({ workspace, filters }) {
  const { data, loading, error } = useReportResource(workspace, "management", filters);
  if (error) return <ReportUnavailable message={error} />;
  if (loading && !data) return <ReportUnavailable message="Loading management reports..." />;
  return <ManagementReportsWorkspace reports={{ management: data || {} }} />;
}

function SalesLazyReports({ workspace, filters }) {
  return <div className="space-y-4"><PaginatedReportPanel workspace={workspace} endpoint="sales" title="Sales report" filters={filters} columns={[["invoice_number", "Invoice"], ["party_name", "Customer"], ["invoice_date", "Date", "date"], ["gross_amount", "Gross", "money"], ["outstanding_amount", "Outstanding", "money"], ["status", "Status"]]} empty="No sales report rows found for the selected filters." /><PaginatedReportPanel workspace={workspace} endpoint="aged-debtors" title="Aged debtors" filters={filters} columns={[["party_code", "Code"], ["party_name", "Customer"], ["invoice_count", "Invoices"], ["total", "Outstanding", "money"]]} empty="No aged debtor rows found for the selected filters." /></div>;
}

function PurchaseLazyReports({ workspace, filters }) {
  return <div className="space-y-4"><PaginatedReportPanel workspace={workspace} endpoint="purchases" title="Purchase report" filters={filters} columns={[["invoice_number", "Bill"], ["party_name", "Supplier"], ["invoice_date", "Date", "date"], ["gross_amount", "Gross", "money"], ["outstanding_amount", "Outstanding", "money"], ["status", "Status"]]} empty="No purchase report rows found for the selected filters." /><PaginatedReportPanel workspace={workspace} endpoint="aged-creditors" title="Aged creditors" filters={filters} columns={[["party_code", "Code"], ["party_name", "Supplier"], ["invoice_count", "Invoices"], ["total", "Outstanding", "money"]]} empty="No aged creditor rows found for the selected filters." /></div>;
}

function LazyListReport({ workspace, endpoint, title, filters, columns, empty }) {
  return <PaginatedReportPanel workspace={workspace} endpoint={endpoint} title={title} filters={filters} columns={columns} empty={empty} />;
}

function LazyReportSettings({ workspace, filters }) {
  const { data, loading, error } = useReportResource(workspace, "settings", filters);
  if (error) return <ReportUnavailable message={error} />;
  if (loading && !data) return <ReportUnavailable message="Loading report settings..." />;
  return <ReportSettingsWorkspace reports={{ settings: data || {} }} />;
}

function FinancialStatementsWorkspace({ workspace, reports, filters, statement = "profit_and_loss" }) {
  const statementTab = statement;
  const pnl = reports.profit_and_loss || {};
  const balanceSheet = reports.balance_sheet || {};
  const cashFlow = reports.cash_flow || {};
  const equity = reports.statement_of_changes_in_equity || {};
  const hasPnl = reportSectionHasData(pnl);
  const hasBalanceSheet = reportSectionHasData(balanceSheet);
  const hasCashFlow = reportSectionHasData(cashFlow);
  const hasEquity = reportSectionHasData(equity);
  const hasTrialBalance = Array.isArray(reports.trial_balance) && reports.trial_balance.length > 0;
  const reportTitle = statementTab === "balance_sheet" ? "Balance Sheet" : "Profit and Loss";
  return (
    <div className="space-y-4">
      <ReportActionBar title={reportTitle} rows={reports.trial_balance || []} />

      {statementTab === "profit_and_loss" ? (
        <Panel title="Profit and Loss">
          {hasPnl ? (
            <div className="mx-auto max-w-5xl space-y-3">
              <StatementContext
                title="Profit and Loss"
                subtitle={reports.presentation?.period_start && reports.presentation?.period_end ? `${formatDate(reports.presentation.period_start)} to ${formatDate(reports.presentation.period_end)}` : "Selected reporting period"}
                note="Corporation tax is presented below profit before tax. Dividends are shown in Changes in Equity, not as an operating expense."
              />
              <FinancialStatementSection title="Turnover" total={pnl.turnover}>
                <ExpandableReportRows workspace={workspace} filters={filters} rows={pnl.sections?.turnover || []} />
              </FinancialStatementSection>
              <FinancialStatementSection title="Cost of sales" total={pnl.cost_of_sales} subtract>
                <ExpandableReportRows workspace={workspace} filters={filters} rows={pnl.sections?.cost_of_sales || []} />
              </FinancialStatementSection>
              <StatementTotalRow label="Gross profit / (loss)" value={pnl.gross_profit} prominent />
              <FinancialStatementSection title="Other operating income" total={pnl.other_operating_income}>
                <ExpandableReportRows workspace={workspace} filters={filters} rows={pnl.sections?.other_operating_income || []} />
              </FinancialStatementSection>
              <FinancialStatementSection title="Operating expenses" total={pnl.operating_expenses} subtract>
                <ExpandableReportRows workspace={workspace} filters={filters} rows={pnl.sections?.operating_expenses || []} />
              </FinancialStatementSection>
              <StatementTotalRow label="Operating profit / (loss)" value={pnl.operating_profit} prominent />
              <FinancialStatementSection title="Finance income" total={pnl.finance_income}>
                <ExpandableReportRows workspace={workspace} filters={filters} rows={pnl.sections?.finance_income || []} />
              </FinancialStatementSection>
              <FinancialStatementSection title="Finance costs" total={pnl.finance_costs} subtract>
                <ExpandableReportRows workspace={workspace} filters={filters} rows={pnl.sections?.finance_costs || []} />
              </FinancialStatementSection>
              <StatementTotalRow label="Profit / (loss) before tax" value={pnl.profit_before_tax} prominent />
              <FinancialStatementSection title="Tax on profit" total={pnl.tax_on_profit} subtract>
                <ExpandableReportRows workspace={workspace} filters={filters} rows={pnl.sections?.tax_on_profit || []} />
              </FinancialStatementSection>
              <StatementTotalRow label="Profit / (loss) after tax" value={pnl.profit_after_tax} prominent final />
            </div>
          ) : <ReportUnavailable message="Profit and loss data is not available in the current workspace." />}
        </Panel>
      ) : null}

      {statementTab === "balance_sheet" ? (
        <Panel title="Balance Sheet">
          {hasBalanceSheet ? (
            <div className="mx-auto max-w-5xl space-y-3">
              <StatementContext title="Balance Sheet" subtitle={balanceSheet.as_at ? `As at ${formatDate(balanceSheet.as_at)}` : "As at the selected reporting date"} note="Balance Sheet figures are cumulative through the reporting date." />
              <FinancialStatementSection title="Assets" total={balanceSheet.assets}>
                <ExpandableReportRows workspace={workspace} filters={filters} rows={balanceSheet.sections?.assets || []} />
              </FinancialStatementSection>
              <FinancialStatementSection title="Liabilities" total={balanceSheet.liabilities}>
                <ExpandableReportRows workspace={workspace} filters={filters} rows={balanceSheet.sections?.liabilities || []} />
              </FinancialStatementSection>
              <StatementTotalRow label="Net assets" value={balanceSheet.net_assets} prominent />
              <FinancialStatementSection title="Equity accounts" total={balanceSheet.equity_accounts}>
                <ExpandableReportRows workspace={workspace} filters={filters} rows={balanceSheet.sections?.equity || []} />
              </FinancialStatementSection>
              <ReportRows rows={[["Profit after tax for the selected period", balanceSheet.current_year_profit], ["Dividends / distributions", balanceSheet.dividends], ["Total equity", balanceSheet.equity]]} />
            </div>
          ) : <ReportUnavailable message="Balance sheet data is not available in the current workspace." />}
        </Panel>
      ) : null}

      {statementTab === "cash_flow" ? (
        <Panel title="Cash Flow Statement">
          {hasCashFlow ? (
            <ReportRows rows={[["Operating activities", cashFlow.operating_activities], ["Investing activities", cashFlow.investing_activities], ["Financing activities", cashFlow.financing_activities], ["Net cash movement", cashFlow.net_cash_movement]]} />
          ) : <ReportUnavailable message="Cash flow data is not available in the current workspace." />}
        </Panel>
      ) : null}

      {statementTab === "changes_in_equity" ? (
        <Panel title="Statement of Changes in Equity">
          {hasEquity ? (
            <div className="space-y-3">
              <StatementContext title="Changes in Equity" subtitle="Selected reporting period" note="Dividends are distributions of profit after Corporation Tax. Prior-period corrections must use the controlled journal and period-lock workflow rather than changing a historical report line." />
              <ReportRows rows={[["Opening equity", equity.opening_equity], ["Profit after tax", equity.current_year_profit], ["Dividends / distributions", equity.dividends], ["Other equity movements", equity.other_equity_movements], ["Closing equity", equity.closing_equity]]} />
              <FinancialStatementSection title="Dividend and distribution accounts" total={equity.dividends}>
                <ExpandableReportRows workspace={workspace} filters={filters} rows={equity.sections?.dividends || []} />
              </FinancialStatementSection>
              <FinancialStatementSection title="Equity account detail" total={equity.closing_equity}>
                <ExpandableReportRows workspace={workspace} filters={filters} rows={equity.sections?.equity || []} />
              </FinancialStatementSection>
            </div>
          ) : <ReportUnavailable message="Equity statement data is not available in the current workspace." />}
        </Panel>
      ) : null}

      {statementTab === "profit_and_loss" && Array.isArray(pnl.analytical_breakdown) && pnl.analytical_breakdown.length ? (
        <Panel title="Profit and Loss analytical breakdown">
          <ReportTable
            rows={pnl.analytical_breakdown}
            columns={[
              ["location_code", "Location"],
              ["location_name", "Location name"],
              ["dimension_type", "Dimension type"],
              ["dimension_code", "Dimension"],
              ["dimension_name", "Dimension name"],
              ["income", "Income", "money"],
              ["expenses", "Expenses", "money"],
              ["profit", "Profit", "money"],
            ]}
            empty="No posted analytical balances match the selected filters."
          />
        </Panel>
      ) : null}
      {statementTab === "trial_balance" ? (
        hasTrialBalance
          ? <TrialBalanceReport workspace={{ ...workspace, reports: { trial_balance: reports.trial_balance, summary: reports.trial_balance_summary || {} } }} filters={filters} />
          : <Panel title="Trial balance"><ReportUnavailable message="No posted balances found for the selected filters." /></Panel>
      ) : null}
    </div>
  );
}

function StatementContext({ title, subtitle, note }) {
  return (
    <div className="rounded-lg border border-emerald-100 bg-emerald-50/40 px-4 py-3">
      <h3 className="font-display text-lg font-semibold text-stone-900">{title}</h3>
      <p className="text-sm text-stone-600">{subtitle}</p>
      <p className="mt-2 text-xs text-stone-500">{note}</p>
    </div>
  );
}

function FinancialStatementSection({ title, total, children, subtract = false }) {
  return (
    <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
      <div className="flex items-center justify-between gap-4 border-b border-stone-200 bg-stone-50 px-4 py-3">
        <p className="font-semibold text-stone-900">{title}</p>
        <p className="font-semibold tabular-nums text-stone-900">{subtract && Number(total || 0) ? `(${formatMoney(Math.abs(Number(total)))})` : formatMoney(total)}</p>
      </div>
      {children}
    </div>
  );
}

function StatementTotalRow({ label, value, prominent = false, final = false }) {
  return (
    <div className={`flex items-center justify-between gap-4 rounded-lg px-4 py-3 ${final ? "border-2 border-emerald-300 bg-emerald-50" : prominent ? "border border-blue-200 bg-blue-50/60" : "border border-stone-200 bg-white"}`}>
      <p className="font-semibold text-stone-900">{label}</p>
      <p className="text-lg font-bold tabular-nums text-stone-900">{formatMoney(value)}</p>
    </div>
  );
}

function reportSectionHasData(value) {
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some((item) => {
    if (Array.isArray(item)) return item.length > 0;
    if (item && typeof item === "object") return reportSectionHasData(item);
    return item !== undefined && item !== null && item !== "";
  });
}

function ReportUnavailable({ message }) {
  return <p className="py-8 text-center text-sm text-stone-500">{message}</p>;
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
        <ReportTable rows={management.department_summary || []} columns={[["department", "Department"], ["income", "Income", "money"], ["expenses", "Expenses", "money"], ["profit", "Profit", "money"]]} empty="No department summary rows yet." />
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

function ExpandableReportRows({ workspace, filters, rows }) {
  const [openCode, setOpenCode] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const safeRows = Array.isArray(rows) ? rows : [];
  const drilldownFilters = useMemo(() => ({ ...filters, search: "" }), [filters]);
  const activityExtra = useMemo(() => ({ account_code: openCode }), [openCode]);
  const { data: activity, loading, error } = useGlPage(workspace, "account-activity", drilldownFilters, page, pageSize, activityExtra);
  useEffect(() => {
    setOpenCode("");
    setPage(1);
  }, [workspace?.client?.id, filters?.date_from, filters?.date_to, filters?.financial_year_id, filters?.period_id, filters?.location_id, filters?.dimension_id]);
  useEffect(() => { setPage(1); }, [pageSize]);
  if (!safeRows.length) return null;

  function toggleRow(code) {
    setOpenCode((current) => current === code ? "" : code);
    setPage(1);
  }

  return (
    <div className="divide-y divide-stone-100">
        {safeRows.map((row) => {
          const isOpen = openCode === row.code;
          return (
            <div key={row.code}>
              <button type="button" onClick={() => toggleRow(row.code)} aria-expanded={isOpen} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-stone-50">
                <span className="flex items-center gap-2">
                  <ArrowRight className={`h-4 w-4 text-stone-400 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                  <span><strong>{row.code}</strong> {row.name}</span>
                </span>
                <span className="font-semibold">{formatMoney(row.balance)}</span>
              </button>
              {isOpen ? (
                <div className="border-t border-emerald-100 bg-emerald-50/20 p-3">
                  <div className="overflow-hidden rounded-lg border border-emerald-100 bg-white">
                    {error ? <p className="py-8 text-center text-sm text-red-700">{error}</p> : loading && !activity.rows.length ? <p className="py-8 text-center text-sm text-stone-500">Loading nominal activity...</p> : <GlActivityTable rows={activity.rows} />}
                    <GlPagination data={activity} loading={loading} setPage={setPage} setPageSize={setPageSize} />
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
    </div>
  );
}

function ReportTable({ rows, columns, empty, compact = false, selectable = false, exportFileName = "selected-rows.csv" }) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const [selectedKeys, setSelectedKeys] = useState([]);
  const rowKey = (row, index) => String(row.id || row.asset_id || row.code || row.asset_code || row.reference || `${row.name || row.description || "row"}-${index}`);
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

  const selectedRows = safeRows.filter((row, index) => selectedKeys.includes(rowKey(row, index)));
  const allSelected = safeRows.length > 0 && selectedRows.length === safeRows.length;

  return (
    <div>
      {selectable && selectedRows.length ? (
        <div className="flex items-center justify-between gap-3 border-b border-stone-200 bg-stone-50 px-3 py-2">
          <span className="text-sm font-semibold text-stone-700">{selectedRows.length} selected</span>
          <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => downloadReportCsv(exportFileName, selectedRows)}>
            <Download className="h-4 w-4" /> Export selected
          </Button>
        </div>
      ) : null}
      <div className="overflow-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
          <tr>
            {selectable ? (
              <th className={`w-10 px-3 ${compact ? "py-1.5" : "py-2"}`}>
                <input
                  type="checkbox"
                  aria-label="Select all rows"
                  checked={allSelected}
                  onChange={(event) => setSelectedKeys(event.target.checked ? safeRows.map(rowKey) : [])}
                />
              </th>
            ) : null}
            {safeColumns.map(({ key, label }) => <th key={key} className={`px-3 ${compact ? "py-1.5" : "py-2"}`}>{label}</th>)}
          </tr>
        </thead>
        <tbody>
          {safeRows.map((row, index) => {
            const keyValue = rowKey(row, index);
            return (
            <tr key={keyValue} className="border-t border-stone-100">
              {selectable ? (
                <td className={`px-3 ${compact ? "py-1.5" : "py-2"}`}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.name || row.asset_name || row.reference || "row"}`}
                    checked={selectedKeys.includes(keyValue)}
                    onChange={(event) => setSelectedKeys((current) => event.target.checked ? [...current, keyValue] : current.filter((key) => key !== keyValue))}
                  />
                </td>
              ) : null}
              {safeColumns.map(({ key, type }) => (
                <td key={key} className={`px-3 ${compact ? "py-1.5" : "py-2"} ${type === "money" ? "text-right font-medium" : ""}`}>
                  {type === "money" ? formatMoney(row[key]) : type === "date" ? formatDate(row[key]) : row[key] ?? "-"}
                </td>
              ))}
            </tr>
          );})}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function TrialBalanceReport({ workspace, filters }) {
  const trialBalance = workspace?.reports?.trial_balance || [];
  const summary = workspace?.reports?.summary || {};
  const clientId = workspace?.client?.id;
  const [openCode, setOpenCode] = useState("");
  const [selectedCodes, setSelectedCodes] = useState([]);
  const [activityPage, setActivityPage] = useState(1);
  const [activityPageSize, setActivityPageSize] = useState(DEFAULT_PAGE_SIZE);
  const activityFilters = useMemo(
    () => ({ ...filters, search: "", date_from: summary.date_mode === "as_at" ? "" : filters?.date_from }),
    [filters, summary.date_mode],
  );
  const activityExtra = useMemo(() => ({ account_code: openCode }), [openCode]);
  const { data: activity, loading: activityLoading, error: activityError } = useGlPage(
    workspace,
    "account-activity",
    activityFilters,
    activityPage,
    activityPageSize,
    activityExtra,
  );

  useEffect(() => {
    setOpenCode("");
    setActivityPage(1);
  }, [clientId, filters?.date_from, filters?.date_to, filters?.financial_year_id, filters?.period_id, filters?.search]);
  useEffect(() => { setActivityPage(1); }, [activityPageSize]);

  function toggleAccount(code) {
    setOpenCode((current) => current === code ? "" : code);
    setActivityPage(1);
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Total debit" value={formatMoney(summary.debit_total)} tone="blue" />
        <SummaryCard label="Total credit" value={formatMoney(summary.credit_total)} tone="emerald" />
        <SummaryCard
          label={summary.balanced ? "Balanced" : "Difference"}
          value={summary.balanced ? formatMoney(0) : formatMoney(summary.difference)}
          tone={summary.balanced ? "emerald" : "amber"}
        />
      </div>
      <Panel title={summary.date_mode === "as_at" ? `Trial balance as at ${formatDate(summary.date_to)}` : "Trial balance"}>
        {selectedCodes.length ? (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-stone-200 bg-stone-50 px-3 py-2">
            <span className="text-sm font-semibold">{selectedCodes.length} selected</span>
            <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => downloadReportCsv("trial-balance.csv", trialBalance.filter((row) => selectedCodes.includes(String(row.code))))}>
              <Download className="h-4 w-4" /> Export selected
            </Button>
          </div>
        ) : null}
        {trialBalance.length === 0 ? (
          <p className="py-8 text-center text-sm text-stone-500">No posted balances found for the selected filters.</p>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="w-10 px-3 py-2"><input type="checkbox" aria-label="Select all trial balance accounts" checked={trialBalance.length > 0 && trialBalance.every((row) => selectedCodes.includes(String(row.code)))} onChange={(event) => setSelectedCodes(event.target.checked ? trialBalance.map((row) => String(row.code)) : [])} /></th>
                  <th className="w-10 px-3 py-2"><span className="sr-only">Open</span></th>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2 text-right">Debit</th>
                  <th className="px-3 py-2 text-right">Credit</th>
                </tr>
              </thead>
              <tbody>
                {trialBalance.map((row) => {
                  const expanded = openCode === row.code;
                  return (
                    <React.Fragment key={row.code}>
                      <tr className={`border-t border-stone-100 ${expanded ? "bg-emerald-50/50" : "hover:bg-stone-50"}`}>
                        <td className="px-3 py-2"><input type="checkbox" aria-label={`Select ${row.code} ${row.name}`} checked={selectedCodes.includes(String(row.code))} onChange={(event) => setSelectedCodes((current) => event.target.checked ? [...current, String(row.code)] : current.filter((code) => code !== String(row.code)))} /></td>
                        <td className="px-3 py-2">
                          <button type="button" onClick={() => toggleAccount(row.code)} aria-expanded={expanded} aria-label={`${expanded ? "Close" : "Open"} ${row.code} activity`} className="rounded p-1 text-stone-500 hover:bg-white hover:text-stone-900">
                            <ArrowRight className={`h-4 w-4 transition-transform ${expanded ? "rotate-90" : ""}`} />
                          </button>
                        </td>
                        <td className="px-3 py-2 font-semibold text-stone-900">
                          <button type="button" onClick={() => toggleAccount(row.code)} className="hover:text-emerald-800 hover:underline">{row.code}</button>
                        </td>
                        <td className="px-3 py-2">
                          <button type="button" onClick={() => toggleAccount(row.code)} className="text-left hover:text-emerald-800 hover:underline">{row.name}</button>
                        </td>
                        <td className="px-3 py-2 text-stone-600">{row.type || row.account_type}</td>
                        <td className="px-3 py-2 text-right">{formatMoney(row.debit)}</td>
                        <td className="px-3 py-2 text-right">{formatMoney(row.credit)}</td>
                      </tr>
                      {expanded ? (
                        <tr className="border-t border-emerald-100 bg-emerald-50/30">
                          <td colSpan={7} className="p-3">
                            <div className="rounded-lg border border-emerald-100 bg-white">
                              <div className="border-b border-stone-100 px-3 py-2">
                                <p className="font-semibold text-stone-900">{row.code} - {row.name}</p>
                                <p className="text-xs text-stone-500">Posted ledger activity contributing to this nominal balance.</p>
                              </div>
                              {activityError ? <p className="py-8 text-center text-sm text-red-700">{activityError}</p> : activityLoading && !activity.rows.length ? <p className="py-8 text-center text-sm text-stone-500">Loading nominal activity...</p> : <GlActivityTable rows={activity.rows} />}
                              <GlPagination data={activity} loading={activityLoading} setPage={setActivityPage} setPageSize={setActivityPageSize} />
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-stone-300 bg-stone-50 font-semibold text-stone-900">
                <tr>
                  <td colSpan={5} className="px-3 py-3 text-right">Total</td>
                  <td className="px-3 py-3 text-right">{formatMoney(summary.debit_total)}</td>
                  <td className="px-3 py-3 text-right">{formatMoney(summary.credit_total)}</td>
                </tr>
              </tfoot>
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
