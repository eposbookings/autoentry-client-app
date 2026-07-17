import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  BookOpen,
  Building2,
  CalendarClock,
  CheckCircle2,
  KeyRound,
  ListChecks,
  Percent,
  PlugZap,
  RefreshCw,
  Save,
  Search,
  Store,
  Trash2,
  Upload,
  UsersRound,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

const DEFAULT_CLIENT_TYPES = [
  ["limited_company", "Limited company"],
  ["sole_trader", "Sole trader"],
  ["partnership", "Partnership"],
  ["llp", "LLP"],
  ["charity", "Charity"],
  ["community_interest_company", "CIC"],
  ["club_or_association", "Club / association"],
  ["landlord", "Landlord"],
  ["individual", "Individual"],
  ["other", "Other"],
];

const INDUSTRIES = [
  "Accommodation and food services",
  "Administrative and support services",
  "Agriculture, forestry and fishing",
  "Arts, entertainment and recreation",
  "Construction",
  "Education",
  "Financial and insurance activities",
  "Health and social work",
  "Information and communication",
  "Manufacturing",
  "Motor trade",
  "Professional, scientific and technical",
  "Property and real estate",
  "Retail and wholesale",
  "Transport and storage",
  "Utilities",
  "Other service activities",
];

const DEFAULT_SERVICES = [
  { key: "accounts", label: "Accounts", deadline: "statutory", recurrence: null, start_date: null, statutory_key: "companies_house_accounts_due" },
  { key: "bookkeeping", label: "Bookkeeping", deadline: null, recurrence: null, start_date: null },
  { key: "ct600_return", label: "CT600 Return", deadline: "statutory", recurrence: null, start_date: null, statutory_key: "hmrc_ct600_filing_due" },
  { key: "payroll", label: "Payroll", deadline: "scheduled", recurrence: "monthly", start_date: null },
  { key: "auto_enrolment", label: "Auto-Enrolment", deadline: "scheduled", recurrence: "annual", start_date: null },
  { key: "vat_returns", label: "VAT Returns", deadline: "statutory", recurrence: null, start_date: null, statutory_key: "hmrc_vat_return_due" },
  { key: "management_accounts", label: "Management Accounts", deadline: "scheduled", recurrence: "monthly", start_date: null },
  { key: "confirmation_statement", label: "Confirmation Statement", deadline: "statutory", recurrence: null, start_date: null, statutory_key: "companies_house_confirmation_due" },
  { key: "cis", label: "CIS", deadline: "scheduled", recurrence: "monthly", start_date: null },
  { key: "p11d", label: "P11D", deadline: "scheduled", recurrence: "annual", start_date: null },
  { key: "fee_protection", label: "Fee Protection Service", deadline: null, recurrence: null, start_date: null },
  { key: "registered_address", label: "Registered Address", deadline: null, recurrence: null, start_date: null },
  { key: "bill_payment", label: "Bill Payment", deadline: null, recurrence: null, start_date: null },
  { key: "consultation_advice", label: "Consultation/Advice", deadline: null, recurrence: null, start_date: null },
  { key: "software", label: "Software", deadline: null, recurrence: null, start_date: null },
  { key: "ct600e", label: "CT600E", deadline: "scheduled", recurrence: "annual", start_date: null },
  { key: "self_assessment", label: "Self Assessment", deadline: "scheduled", recurrence: "annual", start_date: null },
];

const COMBINED_PRICING = [
  { key: "annual_charge", label: "Annual Charge" },
  { key: "monthly_charge", label: "Monthly Charge" },
];

const PRACTICE_FIELDS = [
  "client_type",
  "industry",
  "company_number",
  "company_status",
  "incorporation_date",
  "registered_office_address",
  "trading_address",
  "phone",
  "utr",
  "vat_number",
  "paye_reference",
  "accounts_office_reference",
  "authorisation_codes",
  "services_required",
  "service_settings",
  "statutory_deadlines",
  "deadline_tasks",
  "bookkeeping_frequency",
  "payroll_frequency",
  "year_end",
  "practice_manager",
  "companies_house_last_checked",
  "main_contact_name",
  "main_contact_role",
  "company_directors",
  "company_pscs",
  "company_contacts",
  "companies_house_filings",
];

const INTEGRATION_PROVIDERS = [
  { value: "quickbooks", label: "QuickBooks" },
  { value: "sage", label: "Sage" },
  { value: "xero", label: "Xero" },
];

const INTEGRATION_RECORD_TABS = [
  { key: "account", label: "Chart of Accounts", icon: BookOpen, empty: "No account codes synced or added yet." },
  { key: "supplier", label: "Supplier List", icon: Store, empty: "No suppliers synced or added yet." },
  { key: "customer", label: "Customer List", icon: UsersRound, empty: "No customers synced or added yet." },
  { key: "tax_code", label: "VAT Codes", icon: Percent, empty: "No VAT codes synced or added yet." },
];

const DEFAULT_INTEGRATION_SETTINGS = {
  provider: "quickbooks",
  status: "not_connected",
  company_id: "",
  company_name: "",
  sandbox: false,
  auto_create_suppliers: true,
  auto_create_customers: true,
  default_purchase_account: "",
  default_sales_account: "",
  default_vat_code: "",
  notes: "",
};

export default function AdminClientDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [client, setClient] = useState(null);
  const [items, setItems] = useState({ purchase: [], sales: [] });
  const [pageTab, setPageTab] = useState("details");
  const [itemsTab, setItemsTab] = useState("purchase");
  const [pwd, setPwd] = useState("");
  const [companyQuery, setCompanyQuery] = useState("");
  const [companyResults, setCompanyResults] = useState([]);
  const [companyBusy, setCompanyBusy] = useState(false);
  const [integrationDetail, setIntegrationDetail] = useState({ integration: null, records: {}, counts: {} });
  const [integrationSettings, setIntegrationSettings] = useState(DEFAULT_INTEGRATION_SETTINGS);
  const [integrationTab, setIntegrationTab] = useState("account");
  const [quickBooksConfig, setQuickBooksConfig] = useState({ configured: false, enabled: true, environment: "sandbox" });
  const [integrationBusy, setIntegrationBusy] = useState(false);
  const [serviceCatalog, setServiceCatalog] = useState(DEFAULT_SERVICES);
  const [clientTypes, setClientTypes] = useState(DEFAULT_CLIENT_TYPES.map(([key, label]) => ({ key, label, service_keys: [] })));

  const load = useCallback(async () => {
    try {
      const [c, p, s, integration, quickBooks, services, accountancyClientTypes] = await Promise.all([
        api.get(`/admin/clients/${id}`),
        api.get(`/admin/clients/${id}/items`, { params: { type: "purchase" } }),
        api.get(`/admin/clients/${id}/items`, { params: { type: "sales" } }),
        api.get(`/admin/integrations/clients/${id}`),
        api.get("/admin/integrations/quickbooks/config"),
        api.get("/admin/accountancy/services").catch(() => ({ data: { services: DEFAULT_SERVICES } })),
        api.get("/admin/accountancy/client-types").catch(() => ({ data: { client_types: DEFAULT_CLIENT_TYPES.map(([key, label]) => ({ key, label, service_keys: [] })) } })),
      ]);
      setClient(c.data);
      setCompanyQuery(c.data?.business_name || "");
      setItems({ purchase: p.data, sales: s.data });
      setIntegrationDetail(integration.data);
      setIntegrationSettings({ ...DEFAULT_INTEGRATION_SETTINGS, ...(integration.data.integration || {}) });
      setQuickBooksConfig(quickBooks.data);
      const nextServices = Array.isArray(services.data.services) && services.data.services.length ? services.data.services : DEFAULT_SERVICES;
      const nextClientTypes = Array.isArray(accountancyClientTypes.data.client_types) && accountancyClientTypes.data.client_types.length
        ? accountancyClientTypes.data.client_types
        : DEFAULT_CLIENT_TYPES.map(([key, label]) => ({ key, label, service_keys: [] }));
      setServiceCatalog(nextServices.filter((service) => service.enabled !== false));
      setClientTypes(nextClientTypes);
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const quickbooks = params.get("quickbooks");
    const sync = params.get("sync");
    if (quickbooks === "connected" && sync === "ok") {
      toast.success("Accountancy software connected and lists synced");
      load();
    } else if (quickbooks === "connected" && sync === "error") {
      toast.warning(params.get("message") || "Connected, but list sync needs another try");
      load();
    } else if (quickbooks === "error") {
      toast.error(params.get("message") || "Connection failed");
    } else if (quickbooks === "missing") {
      toast.error("Connection callback was missing required details");
    }
    if (quickbooks) window.history.replaceState({}, "", window.location.pathname);
  }, [load]);

  const clientTypeOptions = useMemo(
    () => (clientTypes.length ? clientTypes : DEFAULT_CLIENT_TYPES.map(([key, label]) => ({ key, label }))).map((type) => [type.key, type.label]),
    [clientTypes]
  );
  const availableServices = useMemo(() => {
    const type = clientTypes.find((item) => item.key === client?.client_type);
    if (!type || !Array.isArray(type.service_keys) || type.service_keys.length === 0) return serviceCatalog;
    const allowed = new Set(type.service_keys);
    return serviceCatalog.filter((service) => allowed.has(service.key));
  }, [clientTypes, client?.client_type, serviceCatalog]);
  const selectedServices = useMemo(
    () => enabledServiceLabels(availableServices, client?.service_settings, client?.services_required),
    [availableServices, client?.service_settings, client?.services_required]
  );
  const serviceSettings = useMemo(() => normaliseServiceSettings(availableServices, client?.service_settings, client?.services_required), [availableServices, client?.service_settings, client?.services_required]);
  const deadlineTasks = useMemo(() => parseStoredList(client?.deadline_tasks), [client?.deadline_tasks]);
  const directors = useMemo(() => parseStoredList(client?.company_directors), [client?.company_directors]);
  const pscs = useMemo(() => parseStoredList(client?.company_pscs), [client?.company_pscs]);
  const contacts = useMemo(() => parseStoredList(client?.company_contacts), [client?.company_contacts]);
  const filings = useMemo(() => parseStoredList(client?.companies_house_filings), [client?.companies_house_filings]);

  function setField(key, value) {
    setClient((current) => ({ ...current, [key]: value }));
  }

  async function saveClient() {
    try {
      const practicePayload = Object.fromEntries(PRACTICE_FIELDS.map((field) => [field, client[field] || null]));
      await api.put(`/admin/clients/${id}`, {
        first_name: client.first_name,
        last_name: client.last_name,
        business_name: client.business_name,
        email: client.email,
        autoentry_email: client.autoentry_email,
        sales_autoentry_email: client.sales_autoentry_email || null,
        status: client.status,
        is_vat_client: !!client.is_vat_client,
        ai_analysis_enabled: !!client.ai_analysis_enabled,
        ...practicePayload,
      });
      toast.success("Client updated");
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }

  async function deleteClient() {
    try {
      await api.delete(`/admin/clients/${id}`);
      toast.success("Client deleted");
      nav("/admin");
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }

  async function resetPassword() {
    if (pwd.length < 6) return toast.error("Password must be at least 6 characters");
    try {
      await api.post(`/admin/clients/${id}/reset-password`, { new_password: pwd });
      toast.success("Password reset");
      setPwd("");
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }

  async function searchCompaniesHouse() {
    if (!companyQuery.trim()) return;
    setCompanyBusy(true);
    try {
      const { data } = await api.get("/admin/companies-house/search", { params: { q: companyQuery.trim() } });
      setCompanyResults(data || []);
      if (!data?.length) toast.info("No Companies House matches found");
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setCompanyBusy(false);
    }
  }

  async function importCompany(companyNumber) {
    setCompanyBusy(true);
    try {
      const { data } = await api.get(`/admin/companies-house/profile/${companyNumber}`);
      setClient((current) => mergeCompanyProfile(current, data));
      setCompanyResults([]);
      toast.success("Companies House details added");
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setCompanyBusy(false);
    }
  }

  async function onUpload(type, file) {
    if (!file) return;
    const fd = new FormData();
    fd.append("type", type);
    fd.append("file", file);
    try {
      const { data } = await api.post(`/admin/clients/${id}/upload-csv`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      if (data.errors && data.errors.length) {
        const preview = data.errors.slice(0, 8).join("\n");
        toast.error(`Imported ${data.rows_imported} rows, ${data.errors.length} row(s) skipped:\n${preview}${data.errors.length > 8 ? `\n...and ${data.errors.length - 8} more` : ""}`, { duration: 12000 });
        console.warn("CSV row errors:", data.errors);
      } else {
        toast.success(`Imported ${data.rows_imported} rows successfully`);
      }
      load();
    } catch (e) {
      toast.error(formatApiError(e), { duration: 10000 });
    }
  }

  function toggleService(service) {
    const current = normaliseServiceSettings(availableServices, client?.service_settings, client?.services_required);
    const nextEnabled = !current[service.key]?.enabled;
    const next = {
      ...current,
      [service.key]: {
        ...(current[service.key] || {}),
        enabled: nextEnabled,
      },
    };
    const enabledLabels = availableServices.filter((item) => next[item.key]?.enabled).map((item) => item.label);
    const existingTasks = parseStoredList(client?.deadline_tasks);
    let nextTasks = existingTasks;

    if (!nextEnabled) {
      nextTasks = existingTasks.filter((task) => task.service !== service.key || task.status === "completed");
    } else if (service.deadline && !existingTasks.some((task) => task.service === service.key && task.status !== "completed")) {
      const windowDates = suggestedDeadlineWindowForService(service, client);
      let nextDue = windowDates.due_date;
      if (!nextDue) {
        nextDue = window.prompt(`Enter the next deadline for ${service.label} (YYYY-MM-DD or DD/MM/YYYY)`);
      }
      if (nextDue) {
        nextTasks = [...existingTasks, createDeadlineTask(service, nextDue, nextDue === windowDates.due_date ? windowDates.source : "manual", windowDates.available_from, windowDates.note)];
      }
    }

    setClient((currentClient) => ({
      ...currentClient,
      service_settings: JSON.stringify(next),
      services_required: enabledLabels.join("\n"),
      deadline_tasks: JSON.stringify(nextTasks),
    }));
  }

  function updateServiceFee(serviceKey, fee) {
    const current = normaliseServiceSettings(availableServices, client?.service_settings, client?.services_required);
    const next = {
      ...current,
      [serviceKey]: {
        ...(current[serviceKey] || {}),
        fee,
      },
    };
    updateServices(next);
  }

  function updateServices(next) {
    const enabledLabels = availableServices.filter((service) => next[service.key]?.enabled).map((service) => service.label);
    setClient((current) => ({
      ...current,
      service_settings: JSON.stringify(next),
      services_required: enabledLabels.join("\n"),
    }));
  }

  function updateCombinedPricing(key, value) {
    const current = normaliseServiceSettings(availableServices, client?.service_settings, client?.services_required);
    const next = {
      ...current,
      combined: {
        ...(current.combined || {}),
        [key]: value,
      },
    };
    updateServices(next);
  }

  function addManualDeadline(serviceKey, dueDate) {
    const service = availableServices.find((item) => item.key === serviceKey);
    if (!service || !dueDate) return;
    setField("deadline_tasks", JSON.stringify([...deadlineTasks, createDeadlineTask(service, dueDate, "manual")]));
  }

  function completeDeadline(taskId) {
    const nextTasks = deadlineTasks.map((task) => (
      task.id === taskId ? { ...task, status: "completed", completed_at: new Date().toISOString() } : task
    ));
    const completed = deadlineTasks.find((task) => task.id === taskId);
    const nextDue = completed ? nextDueFromTask(completed) : null;
    if (completed && nextDue) {
      const nextAvailable = completed.available_from && completed.recurrence
        ? nextDueFromDate(completed.available_from, completed.recurrence)
        : completed.available_from || "";
      nextTasks.push({
        ...completed,
        id: makeLocalId(),
        due_date: nextDue,
        available_from: nextAvailable,
        status: "open",
        completed_at: null,
        created_at: new Date().toISOString(),
      });
    }
    setField("deadline_tasks", JSON.stringify(nextTasks));
  }

  function selectContactAsMain(contact) {
    const names = splitPersonName(contact?.name);
    setClient((current) => ({
      ...current,
      first_name: names.first_name || current.first_name,
      last_name: names.last_name || current.last_name,
      main_contact_name: contact?.name || current.main_contact_name,
      main_contact_role: contact?.role || contact?.kind || current.main_contact_role,
    }));
    toast.success("Main contact selected");
  }

  async function refreshIntegration() {
    const { data } = await api.get(`/admin/integrations/clients/${id}`);
    setIntegrationDetail(data);
    setIntegrationSettings({ ...DEFAULT_INTEGRATION_SETTINGS, ...(data.integration || {}) });
  }

  async function persistIntegrationSettings(showToast = true) {
    await api.put(`/admin/integrations/clients/${id}/settings`, integrationSettings);
    if (showToast) toast.success("Accountancy software settings saved");
    await refreshIntegration();
  }

  async function saveIntegrationSettings(e) {
    e.preventDefault();
    setIntegrationBusy(true);
    try {
      await persistIntegrationSettings(true);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setIntegrationBusy(false);
    }
  }

  async function connectAccountingSoftware() {
    const providerName = providerLabel(integrationSettings.provider);
    if (integrationSettings.provider !== "quickbooks") {
      toast.error(`${providerName} connection is not available yet`);
      return;
    }
    if (quickBooksConfig.enabled === false) {
      toast.error("Accountancy software integration is disabled globally");
      return;
    }
    setIntegrationBusy(true);
    try {
      await persistIntegrationSettings(false);
      const { data } = await api.get(`/admin/integrations/clients/${id}/quickbooks/connect`);
      window.location.href = data.auth_url;
    } catch (e) {
      toast.error(formatApiError(e));
      setIntegrationBusy(false);
    }
  }

  async function syncAccountingSoftware() {
    const providerName = providerLabel(integrationSettings.provider);
    if (integrationSettings.provider !== "quickbooks") {
      toast.error(`${providerName} sync is not available yet`);
      return;
    }
    setIntegrationBusy(true);
    try {
      const { data } = await api.post(`/admin/integrations/clients/${id}/quickbooks/sync`);
      const counts = data.counts || {};
      const warning = (data.warnings || []).filter(Boolean).join(" ");
      toast.success(`Synced ${providerName}: ${counts.account || 0} accounts, ${counts.supplier || 0} suppliers, ${counts.customer || 0} customers, ${counts.tax_code || 0} VAT codes`);
      if (warning) toast.warning(warning, { duration: 9000 });
      await refreshIntegration();
    } catch (e) {
      toast.error(formatApiError(e), { duration: 9000 });
    } finally {
      setIntegrationBusy(false);
    }
  }

  async function deleteIntegrationRecord(recordId) {
    setIntegrationBusy(true);
    try {
      await api.delete(`/admin/integrations/records/${recordId}`);
      toast.success("Synced item removed");
      await refreshIntegration();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setIntegrationBusy(false);
    }
  }

  if (!client) return <div className="text-stone-500">Loading...</div>;

  return (
    <div className="space-y-4">
      <button onClick={() => nav("/admin")} className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-700" data-testid="back-to-clients">
        <ArrowLeft className="h-4 w-4" /> Back to clients
      </button>

      <header className="flex flex-col gap-3 rounded-md border border-stone-200 bg-white p-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate font-display text-2xl font-bold text-stone-900">{client.business_name}</h1>
            {client.client_type && <Badge variant="secondary">{labelFor(clientTypeOptions, client.client_type)}</Badge>}
            {client.company_status && <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">{client.company_status}</Badge>}
          </div>
          <p className="mt-1 text-sm text-stone-600">{client.first_name} {client.last_name} - {client.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={saveClient} className="gap-2" style={{ background: "var(--brand)" }} data-testid="save-client-btn">
            <Save className="h-4 w-4" /> Save
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="gap-2" data-testid="delete-client-btn"><Trash2 className="h-4 w-4" /> Delete</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this client?</AlertDialogTitle>
                <AlertDialogDescription>All outstanding items and submissions will be removed. This cannot be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={deleteClient} className="bg-red-600 hover:bg-red-700" data-testid="confirm-delete-client">Delete client</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </header>

      <Tabs value={pageTab} onValueChange={setPageTab}>
        <TabsList className="grid w-full max-w-4xl grid-cols-4">
          <TabsTrigger value="details" className="gap-2"><Building2 className="h-4 w-4" /> Account details</TabsTrigger>
          <TabsTrigger value="deadlines" className="gap-2"><CalendarClock className="h-4 w-4" /> Deadlines</TabsTrigger>
          <TabsTrigger value="items" className="gap-2"><ListChecks className="h-4 w-4" /> Outstanding items</TabsTrigger>
          <TabsTrigger value="software" className="gap-2"><PlugZap className="h-4 w-4" /> Accountancy software</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="mt-4 space-y-4">
          <section className="rounded-md border border-stone-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold">Client profile</h2>
                <p className="text-xs text-stone-500">Core contact, practice, and Companies House details.</p>
              </div>
              <span className="rounded-md bg-[var(--brand-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--brand)]">Practice record</span>
            </div>

            <div className="grid gap-3 lg:grid-cols-4">
              <SelectField label="Client type" value={client.client_type || ""} onChange={(v) => setField("client_type", v)} options={clientTypeOptions} />
              <SelectField label="Industry" value={client.industry || ""} onChange={(v) => setField("industry", v)} options={INDUSTRIES.map((v) => [v, v])} />
              <Field label="Practice manager" value={client.practice_manager} onChange={(v) => setField("practice_manager", v)} />
              <SelectField label="Status" value={client.status || "active"} onChange={(v) => setField("status", v)} options={[["active", "Active"], ["inactive", "Inactive"]]} />
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-4">
              <Field label="First name" value={client.first_name} onChange={(v) => setField("first_name", v)} testid="edit-first-name" />
              <Field label="Last name" value={client.last_name} onChange={(v) => setField("last_name", v)} testid="edit-last-name" />
              <Field label="Business name" value={client.business_name} onChange={(v) => setField("business_name", v)} testid="edit-business-name" />
              <Field label="Login email" type="email" value={client.email} onChange={(v) => setField("email", v)} testid="edit-email" />
              <Field label="Phone" value={client.phone} onChange={(v) => setField("phone", v)} />
              <Field label="Purchase AutoEntry email" type="email" value={client.autoentry_email} onChange={(v) => setField("autoentry_email", v)} testid="edit-autoentry-email" />
              <Field label="Sales AutoEntry email" type="email" value={client.sales_autoentry_email} onChange={(v) => setField("sales_autoentry_email", v)} testid="edit-sales-autoentry-email" />
              <Field label="Year end" value={client.year_end} onChange={(v) => setField("year_end", v)} placeholder="31/03" />
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-3">
              <Toggle label="VAT client" description="AI checks VAT and invoice evidence before email delivery." checked={!!client.is_vat_client} onChange={(checked) => setField("is_vat_client", checked)} testid="edit-vat-client" />
              <Toggle label="AI analysis" description="Client uploads are reviewed before they are emailed." checked={!!client.ai_analysis_enabled} onChange={(checked) => setField("ai_analysis_enabled", checked)} testid="edit-ai-analysis" />
              <PasswordReset pwd={pwd} setPwd={setPwd} resetPassword={resetPassword} />
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <CompaniesHousePanel
              client={client}
              setField={setField}
              query={companyQuery}
              setQuery={setCompanyQuery}
              results={companyResults}
              busy={companyBusy}
              search={searchCompaniesHouse}
              importCompany={importCompany}
              directors={directors}
              pscs={pscs}
              contacts={contacts}
              filings={filings}
              selectContactAsMain={selectContactAsMain}
            />

            <ServicePricingPanel
              services={availableServices}
              combinedPricing={COMBINED_PRICING}
              settings={serviceSettings}
              selectedServices={selectedServices}
              toggleService={toggleService}
              updateServiceFee={updateServiceFee}
              updateCombinedPricing={updateCombinedPricing}
            />
          </section>

          <section className="rounded-md border border-stone-200 bg-white p-4">
            <h2 className="font-display text-lg font-semibold">HMRC and authorisations</h2>
            <div className="mt-3 grid gap-3 lg:grid-cols-4">
              <Field label="UTR" value={client.utr} onChange={(v) => setField("utr", v)} />
              <Field label="VAT number" value={client.vat_number} onChange={(v) => setField("vat_number", v)} />
              <Field label="PAYE reference" value={client.paye_reference} onChange={(v) => setField("paye_reference", v)} />
              <Field label="Accounts office ref" value={client.accounts_office_reference} onChange={(v) => setField("accounts_office_reference", v)} />
            </div>
            <TextAreaField className="mt-3" label="Authorisation codes / access notes" value={client.authorisation_codes} onChange={(v) => setField("authorisation_codes", v)} placeholder="HMRC agent codes, gateway notes, Companies House auth code, client-specific access notes..." />
          </section>
        </TabsContent>

        <TabsContent value="deadlines" className="mt-4">
          <DeadlinesPanel
            client={client}
            tasks={deadlineTasks}
            services={availableServices}
            setField={setField}
            addManualDeadline={addManualDeadline}
            completeDeadline={completeDeadline}
          />
        </TabsContent>

        <TabsContent value="items" className="mt-4">
          <OutstandingItems items={items} tab={itemsTab} setTab={setItemsTab} onUpload={onUpload} />
        </TabsContent>

        <TabsContent value="software" className="mt-4">
          <AccountancySoftwarePanel
            client={client}
            detail={integrationDetail}
            settings={integrationSettings}
            setSettings={setIntegrationSettings}
            recordTab={integrationTab}
            setRecordTab={setIntegrationTab}
            quickBooksConfig={quickBooksConfig}
            busy={integrationBusy}
            saveSettings={saveIntegrationSettings}
            connect={connectAccountingSoftware}
            sync={syncAccountingSoftware}
            deleteRecord={deleteIntegrationRecord}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ServicePricingPanel({
  services,
  combinedPricing,
  settings,
  selectedServices,
  toggleService,
  updateServiceFee,
  updateCombinedPricing,
}) {
  return (
    <div className="rounded-md border border-stone-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-[var(--brand)]" />
        <div>
          <h2 className="font-display text-lg font-semibold">Services and pricing</h2>
          <p className="text-xs text-stone-500">Enable services, add fees, and deadline tasks are created only where relevant.</p>
        </div>
      </div>
      <div className="divide-y divide-stone-100 rounded-md border border-stone-200">
        {services.map((service) => {
          const active = !!settings[service.key]?.enabled || selectedServices.includes(service.label);
          return (
            <div key={service.key} className="grid gap-3 px-3 py-2.5 sm:grid-cols-[1fr_84px_180px] sm:items-center">
              <div className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 rounded-full ${service.deadline ? "bg-emerald-500" : "bg-stone-300"}`} title={service.deadline ? "Deadline tracked" : "No deadline"} />
                <span className="text-sm font-semibold text-stone-800">{service.label}</span>
                {service.deadline && <Badge variant="secondary" className="text-[10px]">deadline</Badge>}
              </div>
              <Switch checked={active} onChange={() => toggleService(service)} />
              <CurrencyInput value={settings[service.key]?.fee || ""} onChange={(value) => updateServiceFee(service.key, value)} disabled={!active} />
            </div>
          );
        })}
      </div>
      <div className="mt-4">
        <h3 className="mb-2 text-sm font-semibold text-stone-900">Combined pricing</h3>
        <div className="divide-y divide-stone-100 rounded-md border border-stone-200">
          {combinedPricing.map((item) => (
            <div key={item.key} className="grid gap-3 px-3 py-2.5 sm:grid-cols-[1fr_180px] sm:items-center">
              <span className="text-sm font-semibold text-stone-800">{item.label}</span>
              <CurrencyInput value={settings.combined?.[item.key] || ""} onChange={(value) => updateCombinedPricing(item.key, value)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DeadlinesPanel({ client, tasks, services, setField, addManualDeadline, completeDeadline }) {
  const [serviceKey, setServiceKey] = useState(services.find((service) => service.deadline)?.key || "");
  const [dueDate, setDueDate] = useState("");
  const openTasks = tasks.filter((task) => task.status !== "completed").sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  const completedTasks = tasks.filter((task) => task.status === "completed").slice(-8).reverse();
  const deadlineRows = deadlineDisplayRows(openTasks, client, services);

  return (
    <section className="rounded-md border border-stone-200 bg-white p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold">Deadline tasks</h2>
            <p className="text-sm text-stone-600">Relevant services create task-style deadlines. Completing one creates the next date when the recurrence is known.</p>
          </div>
          <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">{deadlineRows.length} open</Badge>
        </div>

        <div className="grid gap-2 rounded-md border border-stone-200 bg-stone-50 p-3 sm:grid-cols-[1fr_180px_auto]">
          <select value={serviceKey} onChange={(e) => setServiceKey(e.target.value)} className="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm">
            {services.filter((service) => service.deadline).map((service) => (
              <option key={service.key} value={service.key}>{service.label}</option>
            ))}
          </select>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-9 bg-white" />
          <Button type="button" variant="outline" onClick={() => { addManualDeadline(serviceKey, dueDate); setDueDate(""); }}>Add deadline</Button>
        </div>

        <div className="mt-4 space-y-2">
          {deadlineRows.length === 0 ? (
            <p className="rounded-md border border-dashed border-stone-300 py-10 text-center text-sm text-stone-500">No open deadlines yet. Enable a deadline service or add one manually.</p>
          ) : deadlineRows.map((task) => {
            return (
              <div key={task.id} className="grid gap-3 rounded-md border border-stone-200 bg-white px-3 py-3 sm:grid-cols-[1fr_220px_auto] sm:items-center">
                <div>
                  <div className="font-semibold text-stone-900">{task.label}</div>
                  <div className="text-xs text-stone-500">{serviceLabel(task.service, services)}{task.source ? ` - ${task.source}` : ""}</div>
                  {task.calculation_note && <div className="mt-1 text-xs text-stone-600">{task.calculation_note}</div>}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md bg-stone-50 px-2 py-1 text-xs">
                    <div className="font-semibold uppercase tracking-wide text-stone-500">Start</div>
                    <div className="text-stone-800">{task.available_from ? formatDisplayDate(task.available_from) : "-"}</div>
                  </div>
                  <DueBadge date={task.due_date} />
                </div>
                {task.synthetic ? (
                  <Badge variant="secondary" className="justify-center">Calculated</Badge>
                ) : (
                  <Button type="button" size="sm" onClick={() => completeDeadline(task.id)} className="gap-2" style={{ background: "var(--brand)" }}>
                    <CheckCircle2 className="h-4 w-4" /> Complete
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        {completedTasks.length > 0 && (
        <div className="rounded-md border border-stone-200 bg-white p-4">
          <h2 className="font-display text-lg font-semibold">Recently completed</h2>
            <div className="mt-3 space-y-2">
              {completedTasks.map((task) => (
                <div key={`${task.id}-done`} className="rounded-md bg-stone-50 px-3 py-2 text-sm">
                  <div className="font-semibold text-stone-800">{task.label}</div>
                  <div className="text-xs text-stone-500">Completed {formatShortDate(task.completed_at)}</div>
                </div>
              ))}
            </div>
        </div>
        )}
    </section>
  );
}

function CompaniesHousePanel({
  client,
  setField,
  query,
  setQuery,
  results,
  busy,
  search,
  importCompany,
  directors,
  pscs,
  contacts,
  filings,
  selectContactAsMain,
}) {
  return (
    <div className="rounded-md border border-stone-200 bg-white p-4">
      <div className="mb-3 flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-[var(--brand)]" />
          <div>
            <h2 className="font-display text-lg font-semibold">Companies House</h2>
            <p className="text-xs text-stone-500">Lookup fills company details, deadlines, directors, PSCs, and contacts.</p>
          </div>
        </div>
        {client.companies_house_last_checked && (
          <Badge variant="secondary">Checked {formatShortDate(client.companies_house_last_checked)}</Badge>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search company name or number" className="h-9" />
        <Button type="button" variant="outline" onClick={search} disabled={busy} className="gap-2">
          <Search className="h-4 w-4" /> Search
        </Button>
      </div>
      {results.length > 0 && (
        <div className="mt-3 max-h-52 overflow-auto rounded-md border border-stone-200">
          {results.map((company) => (
            <button
              key={company.company_number}
              type="button"
              onClick={() => importCompany(company.company_number)}
              className="flex w-full items-start justify-between gap-3 border-b border-stone-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-stone-50"
            >
              <span>
                <span className="block font-semibold text-stone-900">{company.title}</span>
                <span className="block text-xs text-stone-500">{company.company_number} - {company.address || "No address shown"}</span>
              </span>
              <Badge variant="secondary">{company.company_status}</Badge>
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Field label="Company number" value={client.company_number} onChange={(v) => setField("company_number", v)} />
        <Field label="Company status" value={client.company_status} onChange={(v) => setField("company_status", v)} />
        <Field label="Incorporation date" value={client.incorporation_date} onChange={(v) => setField("incorporation_date", v)} />
        <Field label="Main contact" value={client.main_contact_name} onChange={(v) => setField("main_contact_name", v)} />
        <Field label="Main contact role" value={client.main_contact_role} onChange={(v) => setField("main_contact_role", v)} />
        <Field label="SIC / industry" value={client.industry} onChange={(v) => setField("industry", v)} />
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <TextAreaField label="Registered office" value={client.registered_office_address} onChange={(v) => setField("registered_office_address", v)} />
        <TextAreaField label="Trading address" value={client.trading_address} onChange={(v) => setField("trading_address", v)} />
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        <ContactTable title="Directors" contacts={directors} onUse={selectContactAsMain} empty="No active directors imported yet." />
        <ContactTable title="PSCs / owners" contacts={pscs} onUse={selectContactAsMain} empty="No active PSCs imported yet." />
      </div>
      {contacts.length > 0 && (
        <div className="mt-3 rounded-md border border-stone-200 bg-stone-50 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Contact candidates</div>
          <div className="flex flex-wrap gap-2">
            {contacts.slice(0, 12).map((contact, index) => (
              <button
                key={`${contact.name}-${index}`}
                type="button"
                onClick={() => selectContactAsMain(contact)}
                className="rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-700 hover:border-emerald-300 hover:bg-emerald-50"
              >
                {contact.name} <span className="font-normal text-stone-500">{contact.role || contact.kind}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {filings.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-md border border-stone-200">
          <div className="bg-stone-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Recent filings</div>
          <div className="max-h-56 overflow-auto">
            {filings.map((filing, index) => (
              <div key={`${filing.date}-${filing.type}-${index}`} className="grid gap-2 border-t border-stone-100 px-3 py-2 text-xs sm:grid-cols-[90px_90px_1fr]">
                <span className="font-semibold text-stone-800">{filing.date}</span>
                <span className="text-stone-500">{filing.type || filing.category}</span>
                <span className="text-stone-700">{humaniseFiling(filing.description)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ContactTable({ title, contacts, onUse, empty }) {
  return (
    <div className="overflow-hidden rounded-md border border-stone-200">
      <div className="bg-stone-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-stone-500">{title}</div>
      {contacts.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-stone-500">{empty}</p>
      ) : (
        <div className="max-h-64 overflow-auto">
          {contacts.map((contact, index) => (
            <div key={`${contact.name}-${index}`} className="border-t border-stone-100 px-3 py-2 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-stone-900">{contact.name}</div>
                  <div className="text-xs text-stone-500">{contact.role || contact.kind || "Contact"}{contact.appointed_on ? ` - appointed ${contact.appointed_on}` : ""}</div>
                  {contact.address && <div className="mt-1 line-clamp-2 text-xs text-stone-500">{contact.address}</div>}
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => onUse(contact)}>Main</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OutstandingItems({ items, tab, setTab, onUpload }) {
  return (
    <section className="rounded-md border border-stone-200 bg-white p-4">
      <Tabs value={tab} onValueChange={setTab}>
        <div className="mb-4 flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div>
            <h2 className="font-display text-lg font-semibold">Outstanding items</h2>
            <p className="text-xs text-stone-500">Upload and manage purchase or sales items separately.</p>
          </div>
          <TabsList>
            <TabsTrigger value="purchase" data-testid="tab-purchase">Purchase ({items.purchase.length})</TabsTrigger>
            <TabsTrigger value="sales" data-testid="tab-sales">Sales ({items.sales.length})</TabsTrigger>
          </TabsList>
        </div>

        {["purchase", "sales"].map((type) => (
          <TabsContent value={type} key={type} className="space-y-4">
            <CsvUploader type={type} onUpload={onUpload} />
            {items[type].length === 0 ? (
              <p className="py-8 text-center text-sm text-stone-500">No outstanding items. Upload a CSV to get started.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-stone-200">
                <table className="w-full text-sm">
                  <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-3 py-2">Description</th>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items[type].map((item) => (
                      <tr key={item._id} className="border-t border-stone-100" data-testid={`admin-item-${item._id}`}>
                        <td className="px-3 py-2 font-medium text-stone-900">{item.description}</td>
                        <td className="px-3 py-2 text-stone-600">{item.date}</td>
                        <td className="px-3 py-2 text-stone-700">{item.amount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}

function AccountancySoftwarePanel({
  client,
  detail,
  settings,
  setSettings,
  recordTab,
  setRecordTab,
  quickBooksConfig,
  busy,
  saveSettings,
  connect,
  sync,
  deleteRecord,
}) {
  const records = detail.records || {};
  const providerName = providerLabel(settings.provider);
  const accountOptions = (records.account || []).map((record) => recordLabel(record));
  const taxOptions = (records.tax_code || []).map((record) => recordLabel(record, true));
  const isQuickBooks = settings.provider === "quickbooks";
  const globallyDisabled = isQuickBooks && quickBooksConfig.enabled === false;
  const globallyMissing = isQuickBooks && !quickBooksConfig.configured;
  const connectedEnvironment = settings.sandbox ? "sandbox" : "production";

  function updateSetting(key, value) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[0.95fr_1.25fr]">
      <form onSubmit={saveSettings} className="rounded-md border border-stone-200 bg-white p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold">Accountancy software</h2>
            <p className="mt-1 text-sm text-stone-600">
              Connect this client to their accounting package and keep synced accounts, suppliers, customers, and VAT codes on their profile.
            </p>
          </div>
          <Badge className={settings.status === "connected" ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" : "bg-stone-100 text-stone-700 hover:bg-stone-100"}>
            {statusLabel(settings.status)}
          </Badge>
        </div>

        {globallyDisabled && (
          <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Accountancy software integration is disabled globally on the Global integrations page.
          </div>
        )}
        {globallyMissing && (
          <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            QuickBooks app credentials are not configured yet. Save them on Global integrations, then connect this client.
          </div>
        )}
        {!isQuickBooks && (
          <div className="mb-3 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-600">
            {providerName} connection will use this profile area once that provider module is added.
          </div>
        )}
        {settings.status === "connected" && (
          <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Connected accountancy company: <strong>{settings.company_name || settings.company_id || client.business_name}</strong> ({providerName}, {connectedEnvironment}).
          </div>
        )}

        <div className="grid gap-3 lg:grid-cols-2">
          <SelectField
            label="Software"
            value={settings.provider}
            onChange={(value) => updateSetting("provider", value)}
            options={INTEGRATION_PROVIDERS.map(({ value, label }) => [value, label])}
          />
          <SelectField
            label="Status"
            value={settings.status}
            onChange={(value) => updateSetting("status", value)}
            options={[["not_connected", "Not connected"], ["connected", "Connected"], ["paused", "Paused"]]}
          />
          <Field label="Company ID / Realm ID" value={settings.company_id} onChange={(value) => updateSetting("company_id", value)} />
          <Field label="Company name" value={settings.company_name} onChange={(value) => updateSetting("company_name", value)} />
        </div>

        <div className="mt-4 rounded-md border border-stone-200 bg-stone-50 p-3">
          <h3 className="text-sm font-semibold text-stone-900">Default coding</h3>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <IntegrationComboField label="Default purchase account" value={settings.default_purchase_account} onChange={(value) => updateSetting("default_purchase_account", value)} options={accountOptions} />
            <IntegrationComboField label="Default sales account" value={settings.default_sales_account} onChange={(value) => updateSetting("default_sales_account", value)} options={accountOptions} />
            <IntegrationComboField label="Default VAT code" value={settings.default_vat_code} onChange={(value) => updateSetting("default_vat_code", value)} options={taxOptions} />
            <label className="mt-6 flex items-center gap-2 text-sm font-semibold text-stone-700">
              <input type="checkbox" checked={!!settings.sandbox} onChange={(e) => updateSetting("sandbox", e.target.checked)} disabled={settings.status === "connected"} />
              Sandbox company
            </label>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Toggle
              label="Create missing suppliers"
              description="Allow invoice review to create supplier records before publishing purchases."
              checked={!!settings.auto_create_suppliers}
              onChange={(checked) => updateSetting("auto_create_suppliers", checked)}
            />
            <Toggle
              label="Create missing customers"
              description="Allow invoice review to create customer records before publishing sales."
              checked={!!settings.auto_create_customers}
              onChange={(checked) => updateSetting("auto_create_customers", checked)}
            />
          </div>
        </div>

        <TextAreaField className="mt-3" label="Notes" value={settings.notes} onChange={(value) => updateSetting("notes", value)} placeholder="Account mapping, VAT behaviour, sync rules, client-specific integration notes..." />

        <div className="mt-4 flex flex-wrap justify-between gap-2">
          <Button type="submit" disabled={busy} className="gap-2" style={{ background: "var(--brand)" }}>
            <Save className="h-4 w-4" /> Save settings
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={sync} disabled={busy || !isQuickBooks || settings.status !== "connected"} className="gap-2">
              <RefreshCw className="h-4 w-4" /> Sync lists
            </Button>
            <Button type="button" onClick={connect} disabled={busy || !isQuickBooks || globallyDisabled || globallyMissing} className="gap-2" style={{ background: "var(--brand)" }}>
              <PlugZap className="h-4 w-4" /> {settings.status === "connected" ? "Reconnect" : "Connect"} {providerName}
            </Button>
          </div>
        </div>
      </form>

      <div className="rounded-md border border-stone-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-stone-200 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {INTEGRATION_RECORD_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = recordTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setRecordTab(tab.key)}
                  className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold ${isActive ? "bg-[var(--brand)] text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"}`}
                >
                  <Icon className="h-4 w-4" /> {tab.label}
                  <span className={isActive ? "text-white/80" : "text-stone-500"}>{detail.counts?.[tab.key] || 0}</span>
                </button>
              );
            })}
          </div>
          <p className="rounded-md bg-stone-50 px-3 py-2 text-sm text-stone-600">
            Synced from {providerName}. Missing suppliers can be created from invoice review.
          </p>
        </div>

        <div className="max-h-[620px] overflow-auto">
          {(records[recordTab] || []).length === 0 ? (
            <p className="py-24 text-center text-sm text-stone-500">
              {INTEGRATION_RECORD_TABS.find((tab) => tab.key === recordTab)?.empty || "No synced records yet."}
            </p>
          ) : (
            (records[recordTab] || []).map((record) => (
              <RecordRow key={record.id} record={record} onDelete={deleteRecord} />
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function RecordRow({ record, onDelete }) {
  return (
    <div className="grid gap-3 border-b border-stone-100 px-4 py-3 text-sm last:border-b-0 lg:grid-cols-[1fr_160px_180px_auto] lg:items-center">
      <div className="min-w-0">
        <div className="truncate font-semibold text-stone-900">{record.name}</div>
        <div className="truncate text-stone-500">{record.description || record.email || "No description"}</div>
        {record.external_id && <div className="mt-1 text-xs text-stone-400">External ID: {record.external_id}</div>}
      </div>
      <div className="truncate text-stone-600">{record.code || "-"}</div>
      <div className="flex gap-2">
        <Badge className={record.active ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" : "bg-stone-100 text-stone-600 hover:bg-stone-100"}>
          {record.active ? "Active" : "Inactive"}
        </Badge>
        <Badge variant="outline">Synced</Badge>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={() => onDelete(record.id)} className="justify-self-start text-stone-500 hover:text-red-600 lg:justify-self-end">
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

function IntegrationComboField({ label, value, onChange, options }) {
  const listId = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-options`;
  return (
    <div>
      <Label className="text-xs font-semibold text-stone-600">{label}</Label>
      <Input list={listId} value={value || ""} onChange={(e) => onChange(e.target.value)} className="mt-1 h-9" />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder = "", testid }) {
  return (
    <div>
      <Label className="text-xs font-semibold text-stone-600">{label}</Label>
      <Input type={type} value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-1 h-9" data-testid={testid} />
    </div>
  );
}

function TextAreaField({ label, value, onChange, placeholder = "", className = "" }) {
  return (
    <div className={className}>
      <Label className="text-xs font-semibold text-stone-600">{label}</Label>
      <textarea
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 min-h-20 w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
      />
    </div>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <div>
      <Label className="text-xs font-semibold text-stone-600">{label}</Label>
      <select value={value || ""} onChange={(e) => onChange(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm">
        <option value="">Select</option>
        {options.map(([optionValue, labelText]) => (
          <option key={optionValue} value={optionValue}>{labelText}</option>
        ))}
      </select>
    </div>
  );
}

function Toggle({ label, description, checked, onChange, testid }) {
  return (
    <label className="flex items-start gap-3 rounded-md border border-stone-200 bg-stone-50 p-3 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4" data-testid={testid} />
      <span>
        <span className="block font-semibold text-stone-800">{label}</span>
        <span className="block text-xs text-stone-500">{description}</span>
      </span>
    </label>
  );
}

function Switch({ checked, onChange }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`relative h-6 w-11 rounded-full border transition ${checked ? "border-emerald-600 bg-emerald-600" : "border-stone-300 bg-white"}`}
      aria-pressed={checked}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${checked ? "left-5" : "left-0.5"}`} />
    </button>
  );
}

function CurrencyInput({ value, onChange, disabled = false }) {
  return (
    <div className={`flex h-9 overflow-hidden rounded-md border border-stone-200 bg-white shadow-sm ${disabled ? "opacity-50" : ""}`}>
      <span className="flex w-9 items-center justify-center border-r border-stone-200 bg-stone-50 text-sm font-semibold text-stone-500">£</span>
      <input
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        inputMode="decimal"
        className="min-w-0 flex-1 px-2 text-sm outline-none disabled:bg-white"
      />
    </div>
  );
}

function DueBadge({ date }) {
  const days = daysUntil(date);
  const tone = days < 0 ? "bg-red-100 text-red-800" : days <= 14 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800";
  const label = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "Due today" : `${days}d left`;
  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <span className="font-semibold text-stone-900">{formatDisplayDate(date)}</span>
      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{label}</span>
    </div>
  );
}

function PasswordReset({ pwd, setPwd, resetPassword }) {
  return (
    <div className="rounded-md border border-stone-200 bg-stone-50 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-stone-800"><KeyRound className="h-4 w-4" /> Reset password</div>
      <div className="flex gap-2">
        <Input type="text" placeholder="New password" value={pwd} onChange={(e) => setPwd(e.target.value)} className="h-8" data-testid="new-password-input" />
        <Button onClick={resetPassword} variant="outline" size="sm" data-testid="reset-password-btn">Reset</Button>
      </div>
    </div>
  );
}

function CsvUploader({ type, onUpload }) {
  const inputId = `csv-${type}`;
  return (
    <div className="flex flex-col items-start gap-3 rounded-md border border-dashed border-stone-300 bg-stone-50/70 p-4 sm:flex-row sm:items-center">
      <div className="flex-1">
        <p className="text-sm font-semibold text-stone-800">Upload {type === "purchase" ? "Purchase Invoices" : "Sales Invoices"} CSV</p>
        <p className="mt-1 text-xs text-stone-500">Columns: Description, Date, Amount. Uploading replaces the existing list.</p>
      </div>
      <label htmlFor={inputId} className="cursor-pointer">
        <span className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold text-white" style={{ background: "var(--brand)" }} data-testid={`upload-csv-${type}-btn`}>
          <Upload className="h-4 w-4" /> Choose CSV
        </span>
        <input id={inputId} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onUpload(type, e.target.files?.[0])} data-testid={`upload-csv-${type}-input`} />
      </label>
    </div>
  );
}

function splitMulti(value) {
  return String(value || "")
    .split(/\r?\n|,/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function normaliseServiceSettings(services = DEFAULT_SERVICES, value, legacyServices = "") {
  const parsed = parseJsonObject(value);
  const legacy = new Set(splitMulti(legacyServices));
  const result = { ...(parsed || {}) };
  services.forEach((service) => {
    result[service.key] = {
      fee: result[service.key]?.fee || "",
      enabled: !!result[service.key]?.enabled || legacy.has(service.label),
    };
  });
  result.combined = {
    annual_charge: result.combined?.annual_charge || "",
    monthly_charge: result.combined?.monthly_charge || "",
  };
  return result;
}

function enabledServiceLabels(services = DEFAULT_SERVICES, serviceSettings, legacyServices = "") {
  const settings = normaliseServiceSettings(services, serviceSettings, legacyServices);
  return services.filter((service) => settings[service.key]?.enabled).map((service) => service.label);
}

function parseJsonObject(value) {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseStoredList(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function createDeadlineTask(service, dueDate, source = "manual", availableFrom = "", calculationNote = "") {
  return {
    id: makeLocalId(),
    service: service.key,
    label: `${service.label} deadline`,
    due_date: normaliseDateInput(dueDate),
    available_from: normaliseDateInput(availableFrom),
    recurrence: service.recurrence || null,
    start_date: service.start_date || null,
    statutory_key: service.statutory_key || null,
    source,
    calculation_note: calculationNote,
    status: "open",
    created_at: new Date().toISOString(),
    completed_at: null,
  };
}

function suggestedDeadlineForService(service, client) {
  return suggestedDeadlineWindowForService(service, client).due_date;
}

function suggestedDeadlineWindowForService(service, client) {
  if (service.deadline === "statutory" && service.statutory_key) {
    return statutoryWindowForService(service.statutory_key, client);
  }
  if (service.recurrence) {
    const dueDate = nextScheduledDate(service);
    return {
      available_from: service.start_date || "",
      due_date: dueDate,
      source: dueDate ? "scheduled" : "manual",
      note: dueDate ? scheduledRuleNote(service) : "",
    };
  }
  return { available_from: "", due_date: "", source: "manual", note: "" };
}

function statutoryDateForService(key, client) {
  return statutoryWindowForService(key, client).due_date;
}

function statutoryWindowForService(key, client) {
  const text = client?.statutory_deadlines || "";
  const labels = {
    companies_house_accounts_due: "Accounts due",
    companies_house_accounts_made_up_to: "Accounts next made up to",
    companies_house_confirmation_due: "Confirmation statement due",
    companies_house_confirmation_next_statement: "Confirmation next statement date",
  };
  if (key === "companies_house_accounts_due") {
    const explicitDueDate = extractDeadline(text, "Accounts due");
    const periodEnd = accountsPeriodEndForDeadline(client, explicitDueDate);
    const availableFrom = periodEnd || "";
    const dueDate = explicitDueDate || (periodEnd ? addMonthsToIso(periodEnd, 9) : filingHistoryDeadlineForService(key, client, { allowOfficialDate: false }));
    return {
      available_from: availableFrom,
      due_date: dueDate,
      source: dueDate ? "Companies House" : "manual",
      note: dueDate ? "Uses Companies House accounts due date. Start date is the next accounts made up to/period end." : "",
    };
  }
  if (key === "hmrc_ct600_filing_due") {
    const accountsDue = extractDeadline(text, "Accounts due");
    const periodEnd = accountsPeriodEndForDeadline(client, accountsDue);
    const availableFrom = periodEnd || "";
    return {
      available_from: availableFrom,
      due_date: periodEnd ? addMonthsToIso(periodEnd, 12) : "",
      source: periodEnd ? "HMRC rule" : "manual",
      note: periodEnd ? "CT600 starts from the accounts period end and is due 12 months after that period end." : "",
    };
  }
  if (key === "companies_house_confirmation_due") {
    const explicitDueDate = extractDeadline(text, "Confirmation statement due");
    const availableFrom = extractDeadline(text, "Confirmation next statement date") || (explicitDueDate ? addDaysToIso(explicitDueDate, -14) : fallbackConfirmationStatementDate(client));
    const dueDate = explicitDueDate || (availableFrom ? addDaysToIso(availableFrom, 14) : filingHistoryDeadlineForService(key, client, { allowOfficialDate: false }));
    return {
      available_from: availableFrom,
      due_date: dueDate,
      source: dueDate ? "Companies House" : "manual",
      note: dueDate ? "Uses Companies House confirmation statement due date. Start date is the next statement date." : "",
    };
  }
  if (key === "hmrc_cis_return_due") return currentTaxMonthWindow("CIS", 19);
  if (key === "hmrc_paye_monthly_due") return currentTaxMonthWindow("PAYE/NIC", 22);
  if (key === "hmrc_self_assessment_due") return currentSelfAssessmentWindow();
  if (labels[key]) {
    const dueDate = extractDeadline(text, labels[key]);
    return { available_from: "", due_date: dueDate, source: dueDate ? "Companies House" : "manual", note: "" };
  }
  return { available_from: "", due_date: "", source: "manual", note: "" };
}

function deadlineDisplayRows(openTasks, client, services) {
  const enabledKeys = new Set(services.filter((service) => isServiceEnabled(service, client)).map((service) => service.key));
  const rowsByService = new Map();
  openTasks.forEach((task) => {
    if (!enabledKeys.has(task.service)) return;
    const service = services.find((item) => item.key === task.service);
    const statutoryKey = task.statutory_key || service?.statutory_key;
    const refreshedWindow = statutoryKey ? statutoryWindowForService(statutoryKey, client) : null;
    rowsByService.set(task.service, {
      ...task,
      available_from: refreshedWindow?.available_from || task.available_from || "",
      due_date: refreshedWindow?.due_date || task.due_date || "",
      source: refreshedWindow?.source || task.source,
      calculation_note: refreshedWindow?.note || task.calculation_note || "",
    });
  });

  ["accounts", "ct600_return", "confirmation_statement"].forEach((serviceKey) => {
    if (rowsByService.has(serviceKey)) return;
    if (!enabledKeys.has(serviceKey)) return;
    const service = services.find((item) => item.key === serviceKey);
    if (!service?.statutory_key) return;
    const windowDates = statutoryWindowForService(service.statutory_key, client);
    if (!windowDates.due_date) return;
    rowsByService.set(serviceKey, {
      id: `calculated_${serviceKey}`,
      service: serviceKey,
      label: `${service.label} deadline`,
      available_from: windowDates.available_from,
      due_date: windowDates.due_date,
      source: windowDates.source,
      calculation_note: windowDates.note,
      synthetic: true,
    });
  });

  return Array.from(rowsByService.values())
    .filter((row) => row.due_date)
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
}

function statutoryDeadlineWindows(client) {
  return [
    {
      key: "accounts",
      label: "End year accounts",
      ...statutoryWindowForService("companies_house_accounts_due", client),
      fallbackNote: "Accounts window uses the period end as the preparation start and Companies House due date as the finish date.",
    },
    {
      key: "ct600",
      label: "CT600",
      ...statutoryWindowForService("hmrc_ct600_filing_due", client),
      fallbackNote: "CT600 aligns to the same accounting period end and is normally due 12 months later.",
    },
    {
      key: "confirmation",
      label: "Confirmation statement",
      ...statutoryWindowForService("companies_house_confirmation_due", client),
      fallbackNote: "Confirmation window starts on the statement date and runs to the Companies House due date.",
    },
  ]
    .filter((row) => row.available_from || row.due_date)
    .map((row) => ({ ...row, note: row.note || row.fallbackNote }));
}

function extractDeadline(text, label) {
  const line = String(text || "").split(/\r?\n/).find((item) => item.toLowerCase().startsWith(label.toLowerCase()));
  if (!line) return "";
  const match = line.match(/(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/);
  return match ? normaliseDateInput(match[1]) : "";
}

function integratedDeadlineRows(text) {
  return [
    ["Companies House", "Accounts next made up to", extractDeadline(text, "Accounts next made up to")],
    ["Companies House", "Accounts due", extractDeadline(text, "Accounts due")],
    ["Companies House", "Accounts last made up to", extractDeadline(text, "Accounts last made up to")],
    ["Companies House", "Confirmation next statement date", extractDeadline(text, "Confirmation next statement date")],
    ["Companies House", "Confirmation statement due", extractDeadline(text, "Confirmation statement due")],
    ["Companies House", "Confirmation last statement date", extractDeadline(text, "Confirmation last statement date")],
  ]
    .filter(([, , date]) => !!date)
    .map(([source, label, date]) => ({ source, label, date }));
}

function companiesHouseFilingEvidence(client) {
  const filings = parseStoredList(client?.companies_house_filings);
  const rows = [];
  const accounts = latestFilingByKind(filings, "accounts");
  const confirmation = latestFilingByKind(filings, "confirmation");
  if (accounts) {
    rows.push({
      kind: "Accounts filing",
      ...accounts,
      estimated_next_due: filingHistoryDeadlineForService("companies_house_accounts_due", client, { allowOfficialDate: false }),
    });
  }
  if (confirmation) {
    rows.push({
      kind: "Confirmation statement filing",
      ...confirmation,
      estimated_next_due: filingHistoryDeadlineForService("companies_house_confirmation_due", client, { allowOfficialDate: false }),
    });
  }
  return rows;
}

function filingHistoryDeadlineForService(key, client, options = {}) {
  const { allowOfficialDate = true } = options;
  if (allowOfficialDate) {
    const direct = statutoryDateForService(key, client);
    if (direct) return direct;
  }
  const text = client?.statutory_deadlines || "";
  const filings = parseStoredList(client?.companies_house_filings);
  if (key === "companies_house_accounts_due") {
    const nextMadeUpTo = extractDeadline(text, "Accounts next made up to");
    const lastMadeUpTo = extractDeadline(text, "Accounts last made up to");
    if (nextMadeUpTo) return addMonthsToIso(nextMadeUpTo, 9);
    if (lastMadeUpTo) return addMonthsToIso(lastMadeUpTo, 21);
    const filing = latestFilingByKind(filings, "accounts");
    return filing?.date ? addMonthsToIso(filing.date, 21) : "";
  }
  if (key === "companies_house_confirmation_due") {
    const nextStatementDate = extractDeadline(text, "Confirmation next statement date");
    const lastStatementDate = extractDeadline(text, "Confirmation last statement date");
    if (nextStatementDate) return addDaysToIso(nextStatementDate, 14);
    if (lastStatementDate) return addDaysToIso(addMonthsToIso(lastStatementDate, 12), 14);
    const filing = latestFilingByKind(filings, "confirmation");
    return filing?.date ? addDaysToIso(addMonthsToIso(filing.date, 12), 14) : "";
  }
  return "";
}

function accountsPeriodEndForDeadline(client, accountsDue = "") {
  const text = client?.statutory_deadlines || "";
  return extractDeadline(text, "Accounts next made up to") || (accountsDue ? addMonthsToIso(accountsDue, -9) : fallbackAccountsPeriodEnd(client));
}

function fallbackAccountsPeriodEnd(client) {
  const text = client?.statutory_deadlines || "";
  const lastMadeUpTo = extractDeadline(text, "Accounts last made up to");
  if (lastMadeUpTo) return addMonthsToIso(lastMadeUpTo, 12);
  return "";
}

function isServiceEnabled(service, client) {
  const settings = normaliseServiceSettings(DEFAULT_SERVICES, client?.service_settings, client?.services_required);
  if (settings[service.key]?.enabled) return true;
  const current = normaliseServiceSettings([service], client?.service_settings, client?.services_required);
  return !!current[service.key]?.enabled;
}

function fallbackConfirmationStatementDate(client) {
  const text = client?.statutory_deadlines || "";
  const lastStatementDate = extractDeadline(text, "Confirmation last statement date");
  if (lastStatementDate) return addMonthsToIso(lastStatementDate, 12);
  return "";
}

function currentTaxMonthWindow(label, dueDay) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let periodStart = new Date(today.getFullYear(), today.getMonth(), 6);
  if (today.getDate() < 6) periodStart = addMonthsClamped(periodStart, -1, 6);
  let available = addMonthsClamped(periodStart, 1, 6);
  let due = new Date(available.getFullYear(), available.getMonth(), dueDay);
  while (due < today) {
    available = addMonthsClamped(available, 1, 6);
    due = new Date(available.getFullYear(), available.getMonth(), dueDay);
  }
  return {
    available_from: toIsoDate(available),
    due_date: toIsoDate(due),
    source: "HMRC rule",
    note: `${label} window starts after the tax month closes and is due on the ${ordinal(dueDay)} of the following month.`,
  };
}

function currentSelfAssessmentWindow() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let start = new Date(today.getFullYear(), 3, 6);
  if (today < start) start = new Date(today.getFullYear() - 1, 3, 6);
  let due = new Date(start.getFullYear() + 1, 0, 31);
  if (due < today) {
    start = new Date(start.getFullYear() + 1, 3, 6);
    due = new Date(start.getFullYear() + 1, 0, 31);
  }
  return {
    available_from: toIsoDate(start),
    due_date: toIsoDate(due),
    source: "HMRC rule",
    note: "Self Assessment window starts after the tax year ends on 5 April and the online return is due by 31 January.",
  };
}

function scheduledRuleNote(service) {
  if (!service?.recurrence) return "";
  return `Scheduled ${service.recurrence.replace("_", "-")} deadline from the service catalogue start date.`;
}

function ordinal(day) {
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return `${day}${suffix}`;
}

function latestFilingByKind(filings, kind) {
  const matches = filings
    .filter((filing) => filingMatchesKind(filing, kind) && parseLooseDate(filing.date))
    .sort((a, b) => parseLooseDate(b.date) - parseLooseDate(a.date));
  return matches[0] || null;
}

function filingMatchesKind(filing, kind) {
  const text = [
    filing?.category,
    filing?.type,
    filing?.description,
  ].join(" ").toLowerCase();
  if (kind === "accounts") {
    return text.includes("accounts") || /^aa/.test(String(filing?.type || "").toLowerCase());
  }
  if (kind === "confirmation") {
    return text.includes("confirmation") || text.includes("statement") || String(filing?.type || "").toLowerCase().startsWith("cs");
  }
  return false;
}

function friendlyFilingDescription(filing) {
  const description = String(filing?.description || "").replaceAll("-", " ").trim();
  const type = filing?.type ? `Type ${filing.type}` : "";
  const category = filing?.category ? filing.category : "";
  return [description, type, category].filter(Boolean).join(" - ") || "Companies House filing";
}

function addMonthsToIso(value, months) {
  const date = parseLooseDate(value);
  if (!date) return "";
  return toIsoDate(addMonthsClamped(date, months, date.getDate()));
}

function addDaysToIso(value, days) {
  const date = parseLooseDate(value);
  if (!date) return "";
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return toIsoDate(next);
}

function nextDueFromTask(task) {
  const date = parseLooseDate(task.due_date);
  if (!date || !task.recurrence) return null;
  const next = addRecurrence(date, task.recurrence);
  if (!next) return null;
  return toIsoDate(next);
}

function nextDueFromDate(value, recurrence) {
  const date = parseLooseDate(value);
  if (!date || !recurrence) return "";
  const next = addRecurrence(date, recurrence);
  return next ? toIsoDate(next) : "";
}

function nextScheduledDate(service) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (!service.recurrence || !service.start_date) return "";
  let next = parseLooseDate(service.start_date);
  if (!next) return "";
  next.setHours(0, 0, 0, 0);
  while (next < today) {
    const following = addRecurrence(next, service.recurrence);
    if (!following) return "";
    next = following;
  }
  return toIsoDate(next);
}

function addRecurrence(date, recurrence) {
  if (!date) return null;
  const anchorDay = date.getDate();
  const next = new Date(date);
  if (recurrence === "weekly") {
    next.setDate(next.getDate() + 7);
    return next;
  }
  if (recurrence === "monthly") return addMonthsClamped(next, 1, anchorDay);
  if (recurrence === "quarterly") return addMonthsClamped(next, 3, anchorDay);
  if (recurrence === "half_year") return addMonthsClamped(next, 6, anchorDay);
  if (recurrence === "annual") return addMonthsClamped(next, 12, anchorDay);
  return null;
}

function addMonthsClamped(date, months, anchorDay) {
  const next = new Date(date);
  next.setDate(1);
  next.setMonth(next.getMonth() + months);
  next.setDate(Math.min(anchorDay, daysInMonth(next.getFullYear(), next.getMonth())));
  return next;
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function normaliseDateInput(value) {
  const parsed = parseLooseDate(value);
  return parsed ? toIsoDate(parsed) : String(value || "").trim();
}

function parseLooseDate(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const parsed = new Date(`${text}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const parsed = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function toIsoDate(date) {
  if (!date || Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(value) {
  const parsed = parseLooseDate(value);
  if (!parsed) return value || "-";
  return parsed.toLocaleDateString("en-GB");
}

function daysUntil(value) {
  const parsed = parseLooseDate(value);
  if (!parsed) return 9999;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  parsed.setHours(0, 0, 0, 0);
  return Math.round((parsed - today) / 86400000);
}

function makeLocalId() {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function serviceLabel(key, services = DEFAULT_SERVICES) {
  return services.find((service) => service.key === key)?.label || key;
}

function mergeCompanyProfile(current, data) {
  const imported = Object.fromEntries(Object.entries(data || {}).filter(([, value]) => value != null && value !== ""));
  const next = { ...current, ...imported };
  if (current.first_name || current.last_name) {
    next.first_name = current.first_name;
    next.last_name = current.last_name;
  } else if (imported.main_contact_name) {
    const names = splitPersonName(imported.main_contact_name);
    next.first_name = names.first_name;
    next.last_name = names.last_name;
  }
  if (!current.email) next.email = current.email || "";
  if (!current.autoentry_email) next.autoentry_email = current.autoentry_email || "";
  return next;
}

function splitPersonName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first_name: parts[0] || "", last_name: "" };
  return { first_name: parts.slice(0, -1).join(" "), last_name: parts[parts.length - 1] };
}

function formatShortDate(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function humaniseFiling(value) {
  return String(value || "").replace(/-/g, " ");
}

function labelFor(options, value) {
  return options.find(([optionValue]) => optionValue === value)?.[1] || value;
}

function frequencyOptions() {
  return [
    ["weekly", "Weekly"],
    ["fortnightly", "Fortnightly"],
    ["monthly", "Monthly"],
    ["quarterly", "Quarterly"],
    ["annual", "Annual"],
    ["ad_hoc", "Ad hoc"],
  ];
}

function providerLabel(value) {
  return INTEGRATION_PROVIDERS.find((provider) => provider.value === value)?.label || "Accountancy software";
}

function statusLabel(value) {
  const labels = {
    connected: "Connected",
    paused: "Paused",
    not_connected: "Not connected",
  };
  return labels[value] || "Not connected";
}

function recordLabel(record, includeCode = false) {
  const parts = [];
  if (includeCode && record.code) parts.push(record.code);
  if (record.name && !parts.includes(record.name)) parts.push(record.name);
  if (record.description && record.description !== record.name) parts.push(record.description);
  return parts.filter(Boolean).join(" - ") || record.external_id || "";
}
