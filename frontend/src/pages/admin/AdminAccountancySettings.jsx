import React, { useEffect, useMemo, useState } from "react";
import { Building2, CalendarClock, ListChecks, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const FALLBACK_SERVICES = [
  { key: "accounts", label: "Accounts", deadline: "statutory", recurrence: null, start_date: null, statutory_key: "companies_house_accounts_due", enabled: true },
  { key: "bookkeeping", label: "Bookkeeping", deadline: null, recurrence: null, start_date: null, enabled: true },
  { key: "ct600_return", label: "CT600 Return", deadline: "statutory", recurrence: null, start_date: null, statutory_key: "hmrc_ct600_filing_due", enabled: true },
  { key: "corporation_tax_payment", label: "Corporation Tax Payment", deadline: "statutory", recurrence: null, start_date: null, statutory_key: "hmrc_corporation_tax_payment_due", enabled: true },
  { key: "payroll", label: "Payroll", deadline: "scheduled", recurrence: "monthly", start_date: null, enabled: true },
  { key: "auto_enrolment", label: "Auto-Enrolment", deadline: "scheduled", recurrence: "annual", start_date: null, enabled: true },
  { key: "vat_returns", label: "VAT Returns", deadline: "statutory", recurrence: null, start_date: null, statutory_key: "hmrc_vat_return_due", enabled: true },
  { key: "management_accounts", label: "Management Accounts", deadline: "scheduled", recurrence: "monthly", start_date: null, enabled: true },
  { key: "confirmation_statement", label: "Confirmation Statement", deadline: "statutory", recurrence: null, start_date: null, statutory_key: "companies_house_confirmation_due", enabled: true },
  { key: "cis", label: "CIS", deadline: "scheduled", recurrence: "monthly", start_date: null, enabled: true },
  { key: "p11d", label: "P11D", deadline: "scheduled", recurrence: "annual", start_date: null, enabled: true },
  { key: "fee_protection", label: "Fee Protection Service", deadline: null, recurrence: null, start_date: null, enabled: true },
  { key: "registered_address", label: "Registered Address", deadline: null, recurrence: null, start_date: null, enabled: true },
  { key: "bill_payment", label: "Bill Payment", deadline: null, recurrence: null, start_date: null, enabled: true },
  { key: "consultation_advice", label: "Consultation/Advice", deadline: null, recurrence: null, start_date: null, enabled: true },
  { key: "software", label: "Software", deadline: null, recurrence: null, start_date: null, enabled: true },
  { key: "ct600e", label: "CT600E", deadline: "scheduled", recurrence: "annual", start_date: null, enabled: true },
  { key: "self_assessment", label: "Self Assessment", deadline: "scheduled", recurrence: "annual", start_date: null, enabled: true },
  { key: "self_assessment_payment", label: "Self Assessment Payment", deadline: "scheduled", recurrence: "annual", start_date: null, enabled: true },
  { key: "payment_on_account", label: "Payment on Account", deadline: "scheduled", recurrence: "annual", start_date: null, enabled: true },
];

const FALLBACK_STATUTORY_DEADLINES = [
  { key: "companies_house_accounts_due", label: "Accounts due", source: "Companies House", description: "Next accounts filing deadline from Companies House.", rule_description: "Used by the Accounts service. The app stores the Companies House returned accounts due date on the client as 'Accounts due' and uses that exact date when creating the next accounts deadline task. This is preferred over a local formula because Companies House already handles first accounts, changed accounting periods, and overdue flags. Human check: private company annual accounts are normally due 9 months after the accounting reference date; first accounts or changed periods can differ.", ai_update_enabled: true, enabled: true },
  { key: "companies_house_accounts_made_up_to", label: "Accounts made up to", source: "Companies House", description: "Next accounts period end from Companies House.", rule_description: "Reference date only. The app stores the Companies House returned next accounts period end as 'Accounts next made up to'. Use it to verify the accounts period, but do not use it as the filing deadline.", ai_update_enabled: true, enabled: true },
  { key: "companies_house_confirmation_due", label: "Confirmation statement due", source: "Companies House", description: "Next confirmation statement filing deadline from Companies House.", rule_description: "Used by the Confirmation Statement service. The app stores the Companies House returned confirmation statement due date and uses that exact date for the next deadline task.", ai_update_enabled: true, enabled: true },
  { key: "companies_house_confirmation_next_statement", label: "Confirmation statement date", source: "Companies House", description: "Next statement date from Companies House.", rule_description: "Reference date only. This is the next confirmation statement date/period date from Companies House, not the filing deadline.", ai_update_enabled: true, enabled: true },
  { key: "hmrc_ct600_filing_due", label: "CT600 filing due", source: "HMRC", description: "Corporation Tax return filing deadline.", rule_description: "Rule: file the Company Tax Return 12 months after the end of the Corporation Tax accounting period. Data needed: accounting period end date, normally aligned to the accounts period. If HMRC CT data is not connected, the app can calculate this from the client accounting period/account year end and show it for review.", ai_update_enabled: true, enabled: true },
  { key: "hmrc_corporation_tax_payment_due", label: "Corporation Tax payment due", source: "HMRC", description: "Corporation Tax payment deadline.", rule_description: "Rule: Corporation Tax is usually payable 9 months and 1 day after the end of the Corporation Tax accounting period. Data needed: accounting period end date. Exception: large and very large companies may pay by quarterly instalments, so those clients need a separate rule later.", ai_update_enabled: true, enabled: true },
  { key: "hmrc_vat_return_due", label: "VAT return due", source: "HMRC", description: "VAT return deadline from HMRC MTD obligations or VAT period settings.", rule_description: "Best source: HMRC VAT MTD API obligations endpoint, which returns the period due date. Fallback rule: VAT returns are normally due 1 month and 7 days after the VAT period end. Data needed: VAT registration, VAT period frequency and period end date.", ai_update_enabled: true, enabled: true },
  { key: "hmrc_vat_payment_due", label: "VAT payment due", source: "HMRC", description: "VAT payment deadline from HMRC MTD obligations or VAT period settings.", rule_description: "Best source: HMRC VAT MTD API liabilities/payments and obligations where connected. Fallback rule: VAT payment is normally due on the same 1 month and 7 days deadline as the VAT return, but Direct Debit and special schemes may differ.", ai_update_enabled: true, enabled: true },
  { key: "hmrc_paye_monthly_due", label: "PAYE monthly due", source: "HMRC", description: "PAYE/NIC monthly payment deadline.", rule_description: "Rule: PAYE/NIC for a tax month ending on the 5th is due by the 22nd of the following month if paid electronically, or the 19th if paid by post. App default should be the 22nd, with an option to use the 19th for cheque/post clients.", ai_update_enabled: true, enabled: true },
  { key: "hmrc_cis_return_due", label: "CIS return due", source: "HMRC", description: "Monthly CIS contractor return deadline.", rule_description: "Rule: the CIS tax month runs from the 6th to the 5th. The contractor monthly return is due within 14 days of the tax month end, which is normally the 19th of the month. Example: 6 May to 5 June is due by 19 June. CIS deductions are paid with PAYE/CIS payments by the 22nd electronically, or 19th by post.", ai_update_enabled: true, enabled: true },
  { key: "hmrc_p11d_due", label: "P11D due", source: "HMRC", description: "Annual P11D and P11D(b) submission deadline.", rule_description: "Rule: P11D and P11D(b) are due by 6 July after the tax year ends on 5 April. Related payment: Class 1A National Insurance is due by 22 July if paid electronically, or 19 July by cheque/post.", ai_update_enabled: true, enabled: true },
  { key: "hmrc_self_assessment_due", label: "Self Assessment return due", source: "HMRC", description: "Self Assessment tax return filing deadline.", rule_description: "Rule: online Self Assessment returns are normally due by 31 January after the tax year. Paper returns are normally due by 31 October. App default should be online filing on 31 January, with paper filing as an optional client setting later.", ai_update_enabled: true, enabled: true },
  { key: "hmrc_self_assessment_payment_due", label: "Self Assessment payment due", source: "HMRC", description: "Self Assessment balancing payment and first payment on account deadline.", rule_description: "Rule: the balancing payment for the previous tax year and the first payment on account are normally due by 31 January after the tax year.", ai_update_enabled: true, enabled: true },
  { key: "hmrc_payment_on_account_due", label: "Payment on account due", source: "HMRC", description: "Self Assessment second payment on account deadline.", rule_description: "Rule: the second Self Assessment payment on account is normally due by 31 July after the tax year.", ai_update_enabled: true, enabled: true },
];

const FALLBACK_CLIENT_TYPES = [
  { key: "limited_company", label: "Limited company", service_keys: ["accounts", "bookkeeping", "ct600_return", "corporation_tax_payment", "confirmation_statement"] },
  { key: "sole_trader", label: "Sole trader", service_keys: ["bookkeeping", "self_assessment", "self_assessment_payment", "payment_on_account"] },
  { key: "partnership", label: "Partnership", service_keys: ["bookkeeping", "self_assessment", "self_assessment_payment", "payment_on_account"] },
  { key: "llp", label: "LLP", service_keys: ["accounts", "bookkeeping", "confirmation_statement"] },
  { key: "charity", label: "Charity", service_keys: ["accounts", "bookkeeping"] },
  { key: "community_interest_company", label: "CIC", service_keys: ["accounts", "bookkeeping", "ct600_return", "confirmation_statement"] },
  { key: "club_or_association", label: "Club / association", service_keys: ["accounts", "bookkeeping"] },
  { key: "landlord", label: "Landlord", service_keys: ["bookkeeping", "self_assessment", "self_assessment_payment", "payment_on_account"] },
  { key: "individual", label: "Individual", service_keys: ["self_assessment", "self_assessment_payment", "payment_on_account"] },
  { key: "other", label: "Other", service_keys: [] },
];

const DEADLINE_OPTIONS = [
  { value: "", label: "No deadline" },
  { value: "scheduled", label: "Scheduled deadline" },
  { value: "statutory", label: "Statutory deadline" },
];

const RECURRENCE_OPTIONS = [
  { value: "", label: "Ask for first date" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "half_year", label: "Half-yearly" },
  { value: "annual", label: "Annual" },
];

export default function AdminAccountancySettings() {
  const [services, setServices] = useState(FALLBACK_SERVICES);
  const [clientTypes, setClientTypes] = useState(FALLBACK_CLIENT_TYPES);
  const [statutoryDeadlines, setStatutoryDeadlines] = useState(FALLBACK_STATUTORY_DEADLINES);
  const [selectedTypeKey, setSelectedTypeKey] = useState(FALLBACK_CLIENT_TYPES[0].key);
  const [busy, setBusy] = useState(true);
  const [refreshingRules, setRefreshingRules] = useState(false);
  const activeCount = useMemo(() => services.filter((service) => service.enabled).length, [services]);
  const selectedType = clientTypes.find((type) => type.key === selectedTypeKey) || clientTypes[0];
  const activeStatutoryDeadlines = useMemo(
    () => statutoryDeadlines.filter((item) => item.enabled !== false),
    [statutoryDeadlines]
  );

  useEffect(() => {
    Promise.all([
      api.get("/admin/accountancy/services"),
      api.get("/admin/accountancy/client-types"),
      api.get("/admin/accountancy/statutory-deadlines"),
    ])
      .then(([serviceRes, typeRes, statutoryRes]) => {
        const nextStatutory = normaliseStatutoryList(statutoryRes.data.statutory_deadlines);
        const nextServices = normaliseServiceList(serviceRes.data.services);
        const nextTypes = normaliseClientTypeList(typeRes.data.client_types, nextServices);
        setStatutoryDeadlines(nextStatutory);
        setServices(nextServices);
        setClientTypes(nextTypes);
        setSelectedTypeKey((current) => nextTypes.some((type) => type.key === current) ? current : nextTypes[0]?.key);
      })
      .catch((e) => {
        toast.error(formatApiError(e));
        setStatutoryDeadlines(FALLBACK_STATUTORY_DEADLINES);
        setServices(FALLBACK_SERVICES);
        setClientTypes(FALLBACK_CLIENT_TYPES);
      })
      .finally(() => setBusy(false));
  }, []);

  function updateService(index, patch) {
    setServices((current) => current.map((service, idx) => (
      idx === index ? normaliseUiService({ ...service, ...patch }) : service
    )));
  }

  function addService() {
    setServices((current) => [
      ...current,
      {
        key: `custom_${Date.now()}`,
        label: "New service",
        enabled: true,
        deadline: null,
        recurrence: null,
        start_date: null,
        statutory_key: null,
      },
    ]);
  }

  function removeService(index) {
    const removedKey = services[index]?.key;
    setServices((current) => current.filter((_, idx) => idx !== index));
    if (removedKey) {
      setClientTypes((current) => current.map((type) => ({
        ...type,
        service_keys: (type.service_keys || []).filter((key) => key !== removedKey),
      })));
    }
  }

  function updateStatutoryDeadline(index, patch) {
    setStatutoryDeadlines((current) => current.map((item, idx) => (
      idx === index ? normaliseUiStatutoryDeadline({ ...item, ...patch }) : item
    )));
  }

  function refreshStatutoryRules() {
    setRefreshingRules(true);
    const currentByKey = new Map(statutoryDeadlines.map((item) => [item.key, item]));
    const refreshed = FALLBACK_STATUTORY_DEADLINES.map((rule) => normaliseUiStatutoryDeadline({
      ...rule,
      enabled: currentByKey.get(rule.key)?.enabled ?? rule.enabled,
      ai_update_enabled: true,
    }));
    const validKeys = new Set(refreshed.filter((item) => item.enabled !== false).map((item) => item.key));
    const fallbackServiceMap = new Map(FALLBACK_SERVICES.map((service) => [service.key, service.statutory_key]));
    setStatutoryDeadlines(refreshed);
    setServices((current) => current.map((service) => {
      if (service.deadline !== "statutory") return service;
      const preferred = fallbackServiceMap.get(service.key);
      if (service.statutory_key && validKeys.has(service.statutory_key)) return service;
      return normaliseUiService({
        ...service,
        statutory_key: preferred && validKeys.has(preferred) ? preferred : refreshed.find((item) => item.enabled !== false)?.key || null,
      });
    }));
    window.setTimeout(() => setRefreshingRules(false), 250);
    toast.success("Statutory deadline rules refreshed");
  }

  function updateClientType(typeKey, patch) {
    setClientTypes((current) => current.map((type) => (
      type.key === typeKey ? normaliseUiClientType({ ...type, ...patch }) : type
    )));
  }

  function addClientType() {
    const type = { key: `custom_type_${Date.now()}`, label: "New client type", service_keys: [] };
    setClientTypes((current) => [...current, type]);
    setSelectedTypeKey(type.key);
  }

  function removeClientType(typeKey) {
    setClientTypes((current) => {
      const next = current.filter((type) => type.key !== typeKey);
      setSelectedTypeKey(next[0]?.key || "");
      return next;
    });
  }

  function toggleTypeService(typeKey, serviceKey) {
    setClientTypes((current) => current.map((type) => {
      if (type.key !== typeKey) return type;
      const keys = new Set(type.service_keys || []);
      if (keys.has(serviceKey)) keys.delete(serviceKey);
      else keys.add(serviceKey);
      return { ...type, service_keys: Array.from(keys) };
    }));
  }

  async function save() {
    try {
      const servicePayload = services.map(normaliseForSave).filter((service) => service.key && service.label);
      const typePayload = clientTypes.map((type) => normaliseClientTypeForSave(type, servicePayload)).filter((type) => type.key && type.label);
      const statutoryPayload = statutoryDeadlines.map(normaliseStatutoryForSave).filter((item) => item.key && item.label && item.source);
      const serviceRes = await api.put("/admin/accountancy/services", { services: servicePayload });
      const typeRes = await api.put("/admin/accountancy/client-types", { client_types: typePayload });
      const statutoryRes = await api.put("/admin/accountancy/statutory-deadlines", { statutory_deadlines: statutoryPayload });
      const nextServices = normaliseServiceList(serviceRes.data.services);
      const nextTypes = normaliseClientTypeList(typeRes.data.client_types, nextServices);
      setStatutoryDeadlines(normaliseStatutoryList(statutoryRes.data.statutory_deadlines));
      setServices(nextServices);
      setClientTypes(nextTypes);
      setSelectedTypeKey((current) => nextTypes.some((type) => type.key === current) ? current : nextTypes[0]?.key);
      toast.success("Accountancy settings saved");
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-stone-950">Accountancy settings</h1>
          <p className="mt-1 text-sm text-stone-600">Global source for services, client types, and scheduled deadline rules.</p>
        </div>
        <Button type="button" onClick={save} className="gap-2" style={{ background: "var(--brand)" }}>
          <Save className="h-4 w-4" /> Save settings
        </Button>
      </div>

      <Tabs defaultValue="services" className="space-y-4">
        <TabsList className="grid w-full max-w-3xl grid-cols-3">
          <TabsTrigger value="services" className="gap-2">
            <CalendarClock className="h-4 w-4" /> Service catalogue
          </TabsTrigger>
          <TabsTrigger value="statutory" className="gap-2">
            <ListChecks className="h-4 w-4" /> Statutory deadlines
          </TabsTrigger>
          <TabsTrigger value="types" className="gap-2">
            <Building2 className="h-4 w-4" /> Client types
          </TabsTrigger>
        </TabsList>

        <TabsContent value="services" className="space-y-3">
          <section className="rounded-md border border-stone-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
              <div>
                <h2 className="font-display text-lg font-semibold">Service catalogue</h2>
                <p className="text-xs text-stone-500">This feeds the services and pricing section inside each client account.</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">{activeCount} active</Badge>
                <Button type="button" variant="outline" onClick={addService} className="gap-2">
                  <Plus className="h-4 w-4" /> Add service
                </Button>
              </div>
            </div>

            {busy ? (
              <p className="p-8 text-sm text-stone-500">Loading services...</p>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[1220px]">
                  <div className="grid grid-cols-[78px_1.15fr_180px_260px_44px] gap-2 border-b border-stone-100 px-4 py-2 text-xs font-bold uppercase tracking-wide text-stone-500">
                    <span>Use</span>
                    <span>Service</span>
                    <span>Deadline</span>
                    <span>Source / repeat</span>
                    <span />
                  </div>
                  <div className="divide-y divide-stone-100">
                    {services.map((service, index) => (
                      <div key={service.key || index} className="grid grid-cols-[78px_1.15fr_180px_260px_44px] gap-2 px-4 py-2.5">
                        <label className="flex items-center gap-2 text-sm font-semibold text-stone-700">
                          <input type="checkbox" checked={!!service.enabled} onChange={(e) => updateService(index, { enabled: e.target.checked })} />
                          Active
                        </label>
                        <Input value={service.label || ""} onChange={(e) => updateService(index, { label: e.target.value })} placeholder="Service name" className="h-9" />
                        <select
                          value={service.deadline || ""}
                          onChange={(e) => updateService(index, {
                            deadline: e.target.value || null,
                            recurrence: e.target.value === "scheduled" ? (service.recurrence || "") : null,
                            start_date: null,
                            statutory_key: e.target.value === "statutory" ? (service.statutory_key || activeStatutoryDeadlines[0]?.key || null) : null,
                          })}
                          className="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm"
                        >
                          {DEADLINE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                        {service.deadline === "statutory" ? (
                          <select
                            value={service.statutory_key || ""}
                            onChange={(e) => updateService(index, { statutory_key: e.target.value || null })}
                            className="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm"
                          >
                            <option value="">Select statutory source</option>
                            {activeStatutoryDeadlines.map((item) => (
                              <option key={item.key} value={item.key}>{item.source} - {item.label}</option>
                            ))}
                          </select>
                        ) : (
                          <select
                            value={service.recurrence || ""}
                            onChange={(e) => updateService(index, { recurrence: e.target.value || null })}
                            disabled={service.deadline !== "scheduled"}
                            className="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm disabled:bg-stone-100 disabled:text-stone-400"
                          >
                            {RECURRENCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </select>
                        )}
                        <Button type="button" variant="ghost" size="icon" onClick={() => removeService(index)} title="Remove service">
                          <Trash2 className="h-4 w-4 text-stone-500" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </section>
        </TabsContent>

        <TabsContent value="statutory" className="space-y-3">
          <section className="rounded-md border border-stone-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-stone-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="font-display text-lg font-semibold">Statutory deadlines</h2>
                <p className="text-xs text-stone-500">Default deadline rules used by service mappings. Client due dates are calculated from Companies House data, HMRC data, or the scheduled service rule.</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">{activeStatutoryDeadlines.length} active</Badge>
                <Button type="button" variant="outline" onClick={refreshStatutoryRules} disabled={refreshingRules} className="gap-2">
                  <RefreshCw className={`h-4 w-4 ${refreshingRules ? "animate-spin" : ""}`} /> Refresh rules
                </Button>
              </div>
            </div>
            {busy ? (
              <p className="p-8 text-sm text-stone-500">Loading statutory deadlines...</p>
            ) : (
              <div>
                <div className="grid grid-cols-[96px_170px_1fr_240px] gap-3 border-b border-stone-100 px-4 py-2 text-xs font-bold uppercase tracking-wide text-stone-500">
                  <span>Status</span>
                  <span>Source</span>
                  <span>Deadline information</span>
                  <span>Mapped services</span>
                </div>
                <div className="divide-y divide-stone-100">
                  {statutoryDeadlines.map((item, index) => {
                    const usage = statutoryUsage(item.key, services);
                    return (
                      <div key={item.key || index} className="grid gap-3 px-4 py-3 xl:grid-cols-[96px_170px_1fr_240px] xl:items-center">
                        <label className="flex items-center gap-2 text-sm font-semibold text-stone-700">
                          <input type="checkbox" checked={item.enabled !== false} onChange={(e) => updateStatutoryDeadline(index, { enabled: e.target.checked })} />
                          Active
                        </label>
                        <div>
                          <Badge variant="secondary">{item.source}</Badge>
                        </div>
                        <div>
                          <div className="font-semibold text-stone-900">{item.label}</div>
                          <p className="text-xs text-stone-500">{statutoryDeadlineSummary(item)}</p>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {usage.length ? usage.map((label) => (
                            <Badge key={`${item.key}-${label}`} className="bg-stone-100 text-stone-700 hover:bg-stone-100">{label}</Badge>
                          )) : (
                            <span className="text-xs text-stone-400">Not mapped yet</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="border-t border-stone-100 bg-stone-50 px-4 py-3 text-xs text-stone-600">
                  The refresh button restores the built-in statutory rule list and keeps your active/inactive choices. The service catalogue maps services to these rules; client deadline tasks then use the matching Companies House/HMRC source date where available.
                </div>
              </div>
            )}
          </section>
        </TabsContent>

        <TabsContent value="types" className="space-y-3">
          <section className="grid gap-4 xl:grid-cols-[320px_1fr]">
            <div className="rounded-md border border-stone-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
                <div>
                  <h2 className="font-display text-lg font-semibold">Client types</h2>
                  <p className="text-xs text-stone-500">Select a type, then choose its normal services.</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addClientType} className="gap-2">
                  <Plus className="h-4 w-4" /> Add
                </Button>
              </div>
              {busy ? (
                <p className="p-6 text-sm text-stone-500">Loading client types...</p>
              ) : (
                <div className="divide-y divide-stone-100">
                  {clientTypes.map((type) => (
                    <button
                      key={type.key}
                      type="button"
                      onClick={() => setSelectedTypeKey(type.key)}
                      className={`flex w-full items-center justify-between px-4 py-3 text-left ${type.key === selectedTypeKey ? "bg-emerald-50" : "hover:bg-stone-50"}`}
                    >
                      <span>
                        <span className="block text-sm font-semibold text-stone-900">{type.label}</span>
                        <span className="text-xs text-stone-500">{(type.service_keys || []).length} services</span>
                      </span>
                      {type.key === selectedTypeKey && <span className="h-2 w-2 rounded-full bg-emerald-600" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-md border border-stone-200 bg-white p-4 shadow-sm">
              {selectedType ? (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <label className="text-xs font-bold uppercase tracking-wide text-stone-500">Client type name</label>
                      <Input
                        value={selectedType.label || ""}
                        onChange={(e) => updateClientType(selectedType.key, { label: e.target.value })}
                        placeholder="Client type name"
                        className="mt-1 h-10 max-w-xl"
                      />
                    </div>
                    <Button type="button" variant="ghost" onClick={() => removeClientType(selectedType.key)} className="gap-2 text-stone-600">
                      <Trash2 className="h-4 w-4" /> Remove
                    </Button>
                  </div>

                  <div className="mt-5">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-stone-900">Allocated services</h3>
                      <Badge variant="secondary">{(selectedType.service_keys || []).length} selected</Badge>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {services.filter((service) => service.enabled !== false).map((service) => {
                        const checked = (selectedType.service_keys || []).includes(service.key);
                        return (
                          <label key={`${selectedType.key}-${service.key}`} className={`flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm ${checked ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-stone-200 bg-stone-50 text-stone-700"}`}>
                            <span className="font-semibold">{service.label}</span>
                            <input type="checkbox" checked={checked} onChange={() => toggleTypeService(selectedType.key, service.key)} />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : (
                <p className="py-16 text-center text-sm text-stone-500">Create a client type to allocate services.</p>
              )}
            </div>
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function normaliseServiceList(list) {
  const source = Array.isArray(list) && list.length ? list : FALLBACK_SERVICES;
  const seen = new Set(source.map((service) => slugify(service?.key || service?.label)).filter(Boolean));
  const withFallbacks = [
    ...source,
    ...FALLBACK_SERVICES.filter((service) => !seen.has(service.key)),
  ];
  return withFallbacks.map(normaliseUiService).filter((service) => service.key && service.label);
}

function normaliseStatutoryList(list) {
  const source = Array.isArray(list) && list.length ? list : FALLBACK_STATUTORY_DEADLINES;
  return source.map(normaliseUiStatutoryDeadline).filter((item) => item.key && item.label && item.source);
}

function normaliseClientTypeList(list, services) {
  const source = Array.isArray(list) && list.length ? list : FALLBACK_CLIENT_TYPES;
  const serviceKeys = new Set(services.map((service) => service.key));
  return source.map(normaliseUiClientType).map((type) => ({
    ...type,
    service_keys: (type.service_keys || []).filter((key) => serviceKeys.has(key)),
  })).filter((type) => type.key && type.label);
}

function normaliseUiService(service) {
  const deadline = service.deadline === "scheduled" || service.deadline === "statutory" ? service.deadline : null;
  return {
    ...service,
    key: service.key || slugify(service.label),
    deadline,
    recurrence: deadline === "scheduled" ? (service.recurrence || null) : null,
    start_date: null,
    statutory_key: deadline === "statutory" ? (service.statutory_key || null) : null,
    enabled: service.enabled !== false,
  };
}

function normaliseForSave(service) {
  const deadline = service.deadline === "scheduled" || service.deadline === "statutory" ? service.deadline : null;
  return {
    key: slugify(service.key || service.label),
    label: String(service.label || "").trim(),
    deadline,
    recurrence: deadline === "scheduled" ? (service.recurrence || null) : null,
    start_date: null,
    statutory_key: deadline === "statutory" ? (service.statutory_key || null) : null,
    enabled: service.enabled !== false,
  };
}

function normaliseUiStatutoryDeadline(item) {
  const fallback = FALLBACK_STATUTORY_DEADLINES.find((rule) => rule.key === item.key) || {};
  return {
    ...item,
    key: item.key || slugify(`${item.source}_${item.label}`),
    label: String(item.label || "").trim(),
    source: String(item.source || "").trim(),
    description: String(item.description || fallback.description || "").trim(),
    rule_description: String(item.rule_description || fallback.rule_description || "").trim(),
    ai_update_enabled: item.ai_update_enabled !== false,
    enabled: item.enabled !== false,
  };
}

function normaliseStatutoryForSave(item) {
  return {
    key: slugify(item.key || `${item.source}_${item.label}`),
    label: String(item.label || "").trim(),
    source: String(item.source || "").trim(),
    description: String(item.description || "").trim(),
    rule_description: String(item.rule_description || "").trim(),
    ai_update_enabled: true,
    enabled: item.enabled !== false,
  };
}

function statutoryUsage(statutoryKey, services) {
  return services
    .filter((service) => service.deadline === "statutory" && service.statutory_key === statutoryKey && service.enabled !== false)
    .map((service) => service.label);
}

function statutoryDeadlineSummary(item) {
  const key = item?.key || "";
  if (key === "companies_house_accounts_due") return "Start: accounts period end. Due: Companies House accounts due date.";
  if (key === "companies_house_accounts_made_up_to") return "Reference date: accounts period end / made up to.";
  if (key === "companies_house_confirmation_due") return "Start: confirmation statement date. Due: Companies House due date.";
  if (key === "companies_house_confirmation_next_statement") return "Reference date: confirmation statement date.";
  if (key === "hmrc_ct600_filing_due") return "Start: accounts period end. Due: 12 months after period end.";
  if (key === "hmrc_corporation_tax_payment_due") return "Due: normally 9 months and 1 day after period end.";
  if (key === "hmrc_vat_return_due" || key === "hmrc_vat_payment_due") return "Due: from HMRC VAT obligation, or 1 month and 7 days after VAT period end.";
  if (key === "hmrc_paye_monthly_due") return "Window: after tax month closes. Due: 22nd electronically, 19th by post.";
  if (key === "hmrc_cis_return_due") return "Window: after CIS tax month closes. Due: 19th of the following month.";
  if (key === "hmrc_p11d_due") return "Window: after tax year closes. Due: 6 July.";
  if (key === "hmrc_self_assessment_due") return "Window: from 6 April. Due: 31 January online.";
  return item.description || item.label;
}

function normaliseUiClientType(type) {
  return {
    ...type,
    key: type.key || slugify(type.label),
    service_keys: Array.isArray(type.service_keys) ? type.service_keys : [],
  };
}

function normaliseClientTypeForSave(type, services) {
  const serviceKeys = new Set(services.map((service) => service.key));
  return {
    key: slugify(type.key || type.label),
    label: String(type.label || "").trim(),
    service_keys: (type.service_keys || []).filter((key) => serviceKeys.has(key)),
  };
}

function normaliseDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
