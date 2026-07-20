import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError, API } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Archive, ArrowLeft, CheckCircle2, Download, FileText, Inbox, RotateCcw, Search, Sparkles, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";

const listTabs = [
  { key: "inbox", label: "Inbox", icon: Inbox },
  { key: "archived", label: "Archived", icon: Archive },
];
const emptyCodingContext = {};

export default function AdminSubmissions() {
  const [clients, setClients] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [q, setQ] = useState("");
  const [view, setView] = useState("clients");
  const [clientId, setClientId] = useState("");
  const [tab, setTab] = useState("inbox");
  const [documentFilter, setDocumentFilter] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [selectedArchiveIds, setSelectedArchiveIds] = useState([]);
  const [draft, setDraft] = useState(makeDraft(null));
  const [activeField, setActiveField] = useState("vendor_name");
  const [previewObjectUrl, setPreviewObjectUrl] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [busy, setBusy] = useState(false);
  const [moduleDisabled, setModuleDisabled] = useState(false);
  const [clientCodingContext, setClientCodingContext] = useState(null);
  const [submissionCodingContext, setSubmissionCodingContext] = useState(null);

  const load = useCallback(async () => {
    try {
      const [{ data: clientData }, { data: submissionData }] = await Promise.all([
        api.get("/admin/clients"),
        api.get("/admin/submissions"),
      ]);
      setModuleDisabled(false);
      setClients(clientData);
      setSubmissions(submissionData);
    } catch (e) {
      if (e?.response?.status === 403 && String(e?.response?.data?.detail || "").toLowerCase().includes("document processing")) {
        setModuleDisabled(true);
        return;
      }
      toast.error(formatApiError(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const clientCounts = useMemo(() => {
    return submissions.reduce((acc, row) => {
      const cid = row.client_id;
      if (!cid) return acc;
      if (!acc[cid]) acc[cid] = { inbox: 0, archived: 0 };
      const group = statusGroup(row.review_status);
      if (group === "inbox" || group === "archived") acc[cid][group] += 1;
      return acc;
    }, {});
  }, [submissions]);

  const visibleClients = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return clients;
    return clients.filter((client) =>
      [client.business_name, client.first_name, client.last_name, client.email]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(needle))
    );
  }, [clients, q]);

  const selectedClient = clients.find((client) => client._id === clientId);
  const rows = useMemo(() => {
    return submissions
      .filter((row) => row.client_id === clientId)
      .filter((row) => statusGroup(row.review_status) === tab)
      .sort((a, b) => new Date(a.submitted_at || 0) - new Date(b.submitted_at || 0));
  }, [clientId, submissions, tab]);

  const selected = submissions.find((row) => row.id === selectedId) || null;
  const previewUrl = previewObjectUrl;
  const activeCodingContext = submissionCodingContext || clientCodingContext || emptyCodingContext;
  const codingOptions = useMemo(() => buildCodingContextOptions(activeCodingContext), [activeCodingContext]);

  useEffect(() => {
    setSelectedArchiveIds([]);
    setSelectedId("");
  }, [clientId, tab, documentFilter]);

  useEffect(() => {
    if (!clientId) return undefined;
    let cancelled = false;
    const documentType = documentFilter === "sales" ? "sales" : "purchase";
    setClientCodingContext(null);
    api.get(`/admin/submissions/coding-context?client_id=${encodeURIComponent(clientId)}&document_type=${documentType}`)
      .then(({ data }) => {
        if (!cancelled) setClientCodingContext(data || null);
      })
      .catch(() => {
        if (!cancelled) setClientCodingContext(null);
      });
    return () => { cancelled = true; };
  }, [clientId, documentFilter]);

  useEffect(() => {
    if (!selectedId) {
      setSubmissionCodingContext(null);
      return undefined;
    }
    let cancelled = false;
    setSubmissionCodingContext(null);
    api.get(`/admin/submissions/${selectedId}/coding-context`)
      .then(({ data }) => {
        if (!cancelled) setSubmissionCodingContext(data || null);
      })
      .catch(() => {
        if (!cancelled) setSubmissionCodingContext(null);
      });
    return () => { cancelled = true; };
  }, [selectedId]);

  useEffect(() => {
    setDraft(makeDraft(selected));
  }, [selected]);

  useEffect(() => {
    let objectUrl = "";
    setPreviewObjectUrl("");
    setPreviewError("");
    if (!selected?.image_filename) return undefined;

    const filename = encodeURIComponent(selected.image_filename);
    const endpoint = `/admin/uploads/${filename}`;

    api.get(endpoint, { responseType: "blob" })
      .then(({ data }) => {
        objectUrl = window.URL.createObjectURL(data);
        setPreviewObjectUrl(objectUrl);
      })
      .catch((e) => {
        setPreviewError(formatApiError(e));
      });

    return () => {
      if (objectUrl) window.URL.revokeObjectURL(objectUrl);
    };
  }, [selected?.image_filename]);

  function openClient(client, targetTab) {
    setClientId(client._id);
    setTab(targetTab);
    setView("items");
  }

  function openDocument(row) {
    setSelectedId(row.id);
    setView("detail");
  }

  function backToClients() {
    setView("clients");
    setClientId("");
    setSelectedId("");
  }

  function backToList() {
    setView("items");
    setSelectedId("");
  }

  async function refreshCodingContext() {
    if (selectedId) {
      const { data } = await api.get(`/admin/submissions/${selectedId}/coding-context`);
      setSubmissionCodingContext(data || null);
      return data || null;
    }
    if (clientId) {
      const documentType = documentFilter === "sales" ? "sales" : "purchase";
      const { data } = await api.get(`/admin/submissions/coding-context?client_id=${encodeURIComponent(clientId)}&document_type=${documentType}`);
      setClientCodingContext(data || null);
      return data || null;
    }
    return null;
  }

  async function moveSelected(reviewStatus) {
    if (!selected) return;
    const isSalesInvoice = submittedDocumentFlow(selected) === "sales";
    const nextInboxId = reviewStatus === "published" ? getNextRowId(rows, selected.id) : "";
    setBusy(true);
    try {
      const { data } = await api.patch(`/admin/submissions/${selected.id}/review-status`, { review_status: reviewStatus, coding_fields: draft });
      if (reviewStatus === "published" && isSalesInvoice) {
        const arPublish = data?.accounts_receivable_publish || data?.accounts_receivable_invoice || data?.ar_sales_invoice;
        if (arPublish) {
          setDraft((current) => ({
            ...current,
            ar_sales_invoice_id: arPublish.id || arPublish.invoice_id || arPublish.sales_invoice_id || current.ar_sales_invoice_id,
            ar_sales_invoice_url: arPublish.url || arPublish.href || current.ar_sales_invoice_url,
          }));
        }
        toast.success("Published to Accounts Receivable");
      } else if (reviewStatus === "published" && activeCodingContext?.source === "epos_native") {
        toast.success("Published to Accounts Payable");
      } else if (reviewStatus === "published" && activeCodingContext?.source === "external") {
        toast.success(`Published to ${codingProviderLabel(activeCodingContext)}`);
      } else if (reviewStatus === "published" && data?.memory_updated) {
        toast.success("Published to archive and future AI examples updated");
      } else {
        toast.success(reviewStatus === "published" ? "Published to archive" : "Submission updated");
      }
      await load();
      if (reviewStatus === "published" && isSalesInvoice) {
        setSelectedId(selected.id);
        setView("detail");
      } else if (reviewStatus === "published" && nextInboxId) {
        setSelectedId(nextInboxId);
        setView("detail");
      } else {
        setSelectedId("");
        setView("items");
      }
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function prefillSelected() {
    if (!selected) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/admin/submissions/${selected.id}/extract-fields`);
      const fields = data?.ai_extracted_fields || data?.ai_review?.coding_fields || {};
      const updated = { ...selected, ai_extracted_fields: fields, coding_fields: null, ai_review_status: data?.ai_review?.status || selected.ai_review_status };
      setSubmissions((current) => current.map((row) => (row.id === selected.id ? { ...row, ...updated } : row)));
      setDraft(makeDraft(updated));
      toast.success("AI fields populated");
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function suggestLinesFromPattern(patternLine) {
    if (!selected) return;
    if (!patternLine || !Object.values(patternLine).some((value) => String(value || "").trim())) {
      toast.error("Complete one line first, then use it as the pattern");
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post(`/admin/submissions/${selected.id}/suggest-lines`, {
        coding_fields: draft,
        pattern_line: patternLine,
      });
      setDraft((current) => ({
        ...current,
        line_items: data?.line_items?.length ? data.line_items : current.line_items,
      }));
      toast.success("Line items suggested");
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function createSupplierFromDraft() {
    const supplierName = String(draft.vendor_name || "").trim();
    if (!clientId || !supplierName) {
      toast.error("Enter a vendor name first");
      return;
    }
    const supplierCode = window.prompt("Optional supplier account/code", String(draft.vendor_account || "").trim());
    if (supplierCode === null) return;
    setBusy(true);
    try {
      if (activeCodingContext?.source === "epos_native") {
        const { data } = await api.post(`/admin/accounting/clients/${clientId}/ap/suppliers`, {
          name: supplierName,
          supplier_code: String(supplierCode || "").trim(),
          email: null,
        });
        const supplier = data?.supplier || data || {};
        setDraft((current) => ({
          ...current,
          supplier_id: supplier.id || supplier._id || current.supplier_id,
          vendor_name: supplier.name || supplierName,
          vendor_account: supplier.supplier_code || supplier.code || String(supplierCode || "").trim(),
          supplier_code: supplier.supplier_code || supplier.code || String(supplierCode || "").trim(),
        }));
        await refreshCodingContext();
        toast.success("Supplier created in EPOS Native Accounts Payable");
      } else {
        await api.post(`/admin/integrations/clients/${clientId}/records`, {
          record_type: "supplier",
          name: supplierName,
          code: String(supplierCode || "").trim(),
          external_id: "",
          email: null,
          description: "Created from invoice review",
          active: true,
        });
        await refreshCodingContext();
        setDraft((current) => ({ ...current, vendor_account: String(supplierCode || "").trim() }));
        toast.success("Supplier created and added to this client profile");
      }
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function downloadArchive() {
    if (selectedArchiveIds.length === 0) {
      toast.error("Select at least one archived document");
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post("/admin/submissions/download", { ids: selectedArchiveIds }, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([data], { type: "application/zip" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${slug(selectedClient?.business_name || "submissions")}-archive.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  }

  function toggleArchiveSelection(id) {
    setSelectedArchiveIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  return (
    <div className="min-h-[calc(100vh-3rem)]">
      {moduleDisabled && (
        <div className="flex min-h-[520px] items-center justify-center">
          <div className="max-w-lg rounded-2xl border border-stone-200 bg-white p-8 text-center shadow-sm">
            <FileText className="mx-auto h-10 w-10 text-stone-400" />
            <h1 className="mt-4 font-display text-2xl font-bold text-stone-900">Document processing is disabled</h1>
            <p className="mt-2 text-sm leading-relaxed text-stone-600">
              The admin Submitted items inbox is turned off in Settings. Client uploads, AI checks before email, stamps, and email delivery still continue normally.
            </p>
          </div>
        </div>
      )}

      {!moduleDisabled && view === "clients" && (
        <ClientsLayer
          clients={visibleClients}
          counts={clientCounts}
          q={q}
          setQ={setQ}
          openClient={openClient}
        />
      )}

      {!moduleDisabled && view === "items" && (
        <ItemsLayer
          client={selectedClient}
          rows={rows}
          tab={tab}
          setTab={setTab}
          documentFilter={documentFilter}
          setDocumentFilter={setDocumentFilter}
          backToClients={backToClients}
          openDocument={openDocument}
          selectedArchiveIds={selectedArchiveIds}
          toggleArchiveSelection={toggleArchiveSelection}
          downloadArchive={downloadArchive}
          busy={busy}
        />
      )}

      {!moduleDisabled && view === "detail" && (
        <DetailLayer
          client={selectedClient}
          row={selected}
          draft={draft}
          setDraft={setDraft}
          activeField={activeField}
          setActiveField={setActiveField}
          backToList={backToList}
          previewUrl={previewUrl}
          previewError={previewError}
          prefillSelected={prefillSelected}
          suggestLinesFromPattern={suggestLinesFromPattern}
          moveSelected={moveSelected}
          createSupplierFromDraft={createSupplierFromDraft}
          codingContext={activeCodingContext}
          codingOptions={codingOptions}
          busy={busy}
        />
      )}
    </div>
  );
}

function ClientsLayer({ clients, counts, q, setQ, openClient }) {
  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-stone-900">Submitted items</h1>
          <p className="text-sm text-stone-600">Open a client inbox or archive to review submitted invoices and receipts.</p>
        </div>
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <Input placeholder="Search clients" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 pl-10" />
        </div>
      </header>

      {clients.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 bg-white p-12 text-center text-stone-500">
          No submitted items yet.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {clients.map((client) => {
            const count = counts[client._id] || { inbox: 0, archived: 0 };
            return (
              <div key={client._id} className="rounded-md border border-stone-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-display text-base font-semibold text-stone-900">{client.business_name}</div>
                    <div className="text-sm text-stone-500">{client.first_name} {client.last_name}</div>
                  </div>
                  <Badge variant={client.status === "active" ? "default" : "secondary"} className={client.status === "active" ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" : ""}>
                    {client.status}
                  </Badge>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => openClient(client, "inbox")}
                    className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-left hover:border-amber-300"
                  >
                    <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">Inbox</div>
                    <div className="font-display text-2xl font-bold text-amber-700">{count.inbox || 0}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => openClient(client, "archived")}
                    className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2.5 text-left hover:border-stone-300"
                  >
                    <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">Archived</div>
                    <div className="font-display text-2xl font-bold text-stone-700">{count.archived || 0}</div>
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {client.is_vat_client && <Badge className="bg-sky-100 text-sky-800 hover:bg-sky-100">VAT client</Badge>}
                  {client.ai_analysis_enabled && <Badge className="bg-violet-100 text-violet-800 hover:bg-violet-100">AI analysis</Badge>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ItemsLayer({
  client,
  rows,
  tab,
  setTab,
  documentFilter,
  setDocumentFilter,
  backToClients,
  openDocument,
  selectedArchiveIds,
  toggleArchiveSelection,
  downloadArchive,
  busy,
}) {
  const filteredRows = useMemo(() => {
    if (documentFilter === "all") return rows;
    return rows.filter((row) => submittedDocumentFlow(row) === documentFilter);
  }, [documentFilter, rows]);
  const flowCounts = useMemo(() => rows.reduce((acc, row) => {
    acc[submittedDocumentFlow(row)] += 1;
    return acc;
  }, { purchase: 0, sales: 0, unclassified: 0 }), [rows]);

  return (
    <div className="flex h-[calc(100vh-2rem)] min-h-[660px] flex-col overflow-hidden">
      <header className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" onClick={backToClients} className="h-9 gap-2">
            <ArrowLeft className="h-4 w-4" /> Clients
          </Button>
          <div>
            <h1 className="font-display text-xl font-bold text-stone-900">{client?.business_name || "Client"}</h1>
            <p className="text-sm text-stone-500">{filteredRows.length} {filteredRows.length === 1 ? "document" : "documents"} in {tab}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {listTabs.map((item) => {
            const Icon = item.icon;
            const active = tab === item.key;
            return (
              <Button
                key={item.key}
                type="button"
                variant={active ? "default" : "outline"}
                onClick={() => setTab(item.key)}
                className="h-9 gap-2"
                style={active ? { background: "var(--brand)" } : undefined}
              >
                <Icon className="h-4 w-4" /> {item.label}
              </Button>
            );
          })}
          {tab === "archived" && (
            <Button type="button" variant="outline" onClick={downloadArchive} disabled={busy || selectedArchiveIds.length === 0} className="h-9 gap-2">
              <Download className="h-4 w-4" /> Download selected
            </Button>
          )}
        </div>
      </header>

      <div className="mb-3 flex flex-wrap gap-2">
        {[
          { key: "all", label: "All submitted items", count: rows.length },
          { key: "purchase", label: "Purchase invoices", count: flowCounts.purchase },
          { key: "sales", label: "Sales invoices", count: flowCounts.sales },
          { key: "unclassified", label: "Unclassified / needs review", count: flowCounts.unclassified },
        ].map((item) => {
          const active = documentFilter === item.key;
          return (
            <Button
              key={item.key}
              type="button"
              variant={active ? "default" : "outline"}
              onClick={() => setDocumentFilter(item.key)}
              className="h-8 gap-2 px-3"
              style={active ? { background: "var(--brand)" } : undefined}
            >
              {item.label}
              <Badge variant="secondary" className="bg-white/80 text-stone-700">{item.count}</Badge>
            </Button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
            <tr>
              {tab === "archived" && <th className="w-10 px-3 py-2"></th>}
              <th className="px-3 py-2">Document</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Submitted</th>
              <th className="px-3 py-2">AI</th>
              <th className="px-3 py-2">Comment</th>
              <th className="px-3 py-2 text-right">Open</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td className="px-4 py-12 text-center text-stone-500" colSpan={tab === "archived" ? 7 : 6}>No documents here.</td>
              </tr>
            ) : filteredRows.map((row) => (
              <tr key={row.id} className="border-t border-stone-100 hover:bg-stone-50">
                {tab === "archived" && (
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedArchiveIds.includes(row.id)}
                      onChange={() => toggleArchiveSelection(row.id)}
                      className="h-4 w-4"
                    />
                  </td>
                )}
                <td className="px-3 py-2">
                  <div className="flex items-center gap-3">
                    <FileText className="h-4 w-4 text-stone-500" />
                    <div className="min-w-0">
                      <div className="font-semibold text-stone-900">{row.description || "Submitted document"}</div>
                      <div className="max-w-lg truncate text-xs text-stone-500">{row.image_filename || "No file"}</div>
                      {submittedDocumentFlow(row) === "sales" && (
                        <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                          <Badge variant="secondary">Review: {row.review_status || "inbox"}</Badge>
                          <Badge variant="secondary">Customer match: {salesCustomerMatchStatus(row)}</Badge>
                          <Badge className={row.review_status === "published" ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" : "bg-stone-100 text-stone-700 hover:bg-stone-100"}>
                            {row.review_status === "published" ? "Published to Accounts Receivable" : "Not published"}
                          </Badge>
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="secondary" className="capitalize">{submittedDocumentTypeLabel(row)}</Badge>
                    {submittedDocumentFlow(row) === "sales" && <Badge className="bg-sky-100 text-sky-800 hover:bg-sky-100">Accounts Receivable</Badge>}
                    {submittedDocumentFlow(row) === "purchase" && <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Accounts Payable</Badge>}
                    {submittedDocumentFlow(row) === "unclassified" && <Badge className="bg-stone-100 text-stone-700 hover:bg-stone-100">Needs review</Badge>}
                  </div>
                </td>
                <td className="px-3 py-2 text-stone-600">{formatDateTime(row.submitted_at)}</td>
                <td className="px-3 py-2">
                  {submittedDocumentFlow(row) === "sales" && <ConfidenceBadge value={aiConfidence(row)} />}
                  {submittedDocumentFlow(row) !== "sales" && row.ai_review_status === "approved" && <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Checked</Badge>}
                  {row.ai_client_approved && <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">Client approved</Badge>}
                  {submittedDocumentFlow(row) !== "sales" && !row.ai_review_status && !row.ai_client_approved && <span className="text-stone-400">-</span>}
                </td>
                <td className="max-w-md truncate px-3 py-2 text-stone-600">{row.comment || "-"}</td>
                <td className="px-3 py-2 text-right">
                  <Button type="button" size="sm" variant="outline" onClick={() => openDocument(row)}>Review</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DetailLayer({
  client,
  row,
  draft,
  setDraft,
  activeField,
  setActiveField,
  backToList,
  previewUrl,
  previewError,
  prefillSelected,
  suggestLinesFromPattern,
  moveSelected,
  createSupplierFromDraft,
  codingContext,
  codingOptions,
  busy,
}) {
  if (!row) {
    return (
      <div className="flex h-[calc(100vh-3rem)] items-center justify-center text-stone-500">
        Select a document to review.
      </div>
    );
  }
  if (submittedDocumentFlow(row) === "sales") {
    return (
      <SalesInvoiceDetailLayer
        client={client}
        row={row}
        draft={draft}
        setDraft={setDraft}
        activeField={activeField}
        setActiveField={setActiveField}
        backToList={backToList}
        previewUrl={previewUrl}
        previewError={previewError}
        prefillSelected={prefillSelected}
        moveSelected={moveSelected}
        codingContext={codingContext}
        codingOptions={codingOptions}
        busy={busy}
      />
    );
  }
  return (
    <div className="flex h-[calc(100vh-1.5rem)] min-h-[660px] flex-col overflow-hidden">
      <header className="mb-2 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Button type="button" variant="outline" onClick={backToList} className="h-8 gap-2 px-3">
            <ArrowLeft className="h-4 w-4" /> {client?.business_name || "Documents"}
          </Button>
          <div className="min-w-0">
            <h1 className="truncate font-display text-lg font-bold text-stone-900">{row.description || "Submitted document"}</h1>
            <p className="truncate text-xs text-stone-500">{row.image_filename || "No file"} {row.comment ? `- ${row.comment}` : ""}</p>
          </div>
          <CodingSourceBadge context={codingContext} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={prefillSelected} disabled={busy} className="h-8 gap-2 px-3">
            <Sparkles className="h-4 w-4" /> AI prefill
          </Button>
          <Button type="button" variant="outline" onClick={() => moveSelected("archived")} disabled={busy} className="h-8 gap-2 px-3">
            <Archive className="h-4 w-4" /> Archive
          </Button>
          <Button type="button" onClick={() => moveSelected("published")} disabled={busy || (codingContext?.source === "epos_native" && !draft.supplier_id)} className="h-8 gap-2 px-3" style={{ background: "var(--brand)" }}>
            <CheckCircle2 className="h-4 w-4" /> Publish and Next
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-2 xl:grid-cols-[minmax(520px,0.95fr)_minmax(640px,1.05fr)]">
        <section className="min-h-0 overflow-hidden rounded-md border border-stone-200 bg-white">
          <ReviewForm
            draft={draft}
            setDraft={setDraft}
            activeField={activeField}
            setActiveField={setActiveField}
            suggestLinesFromPattern={suggestLinesFromPattern}
            createSupplierFromDraft={createSupplierFromDraft}
            codingContext={codingContext}
            codingOptions={codingOptions}
            busy={busy}
          />
        </section>
        <section className="min-h-0 overflow-hidden rounded-md border border-stone-200 bg-stone-100">
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between gap-3 border-b border-stone-200 bg-white px-3 py-2">
              <div className="min-w-0">
                <div className="truncate font-semibold text-stone-900">{row.image_filename || "Document preview"}</div>
                <div className="truncate text-xs text-stone-500">{row.comment || "No client comment"}</div>
              </div>
              <Badge variant="secondary" className="shrink-0 capitalize">{row.review_status || "inbox"}</Badge>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {row.image_filename ? (
                <div className="relative min-h-[640px] overflow-auto rounded-md border border-stone-200 bg-white">
                  {previewUrl ? (
                    isPdfFile(row.image_filename) ? (
                      <iframe title="Submitted PDF" src={previewUrl} className="h-[calc(100vh-9rem)] min-h-[640px] w-full rounded-md bg-white" />
                    ) : (
                      <img src={previewUrl} alt="Submitted" className="block w-full rounded-md bg-white" />
                    )
                  ) : previewError ? (
                    <div className="flex h-full min-h-[640px] items-center justify-center p-6 text-center text-sm text-red-600">
                      {previewError}
                    </div>
                  ) : (
                    <div className="flex h-full min-h-[640px] items-center justify-center text-stone-500">
                      Loading preview...
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex h-full min-h-[640px] items-center justify-center rounded-md border border-dashed border-stone-300 bg-white text-stone-500">
                  No document attached
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function SalesInvoiceDetailLayer({
  client,
  row,
  draft,
  setDraft,
  activeField,
  setActiveField,
  backToList,
  previewUrl,
  previewError,
  prefillSelected,
  moveSelected,
  codingContext,
  codingOptions,
  busy,
}) {
  const publishSalesInvoice = () => {
    const summary = [
      "Publish this sales invoice to Accounts Receivable?",
      "",
      `Customer: ${draft.customer_name || "Not set"}`,
      `Invoice number: ${draft.sales_invoice_number || draft.reference || "Not set"}`,
      `Invoice date: ${draft.invoice_date || draft.date || "Not set"}`,
      `Due date: ${draft.due_date || "Not set"}`,
      `Net/VAT/Gross: ${draft.net || "0.00"} / ${draft.vat || "0.00"} / ${draft.total || "0.00"}`,
      "Destination: Accounts Receivable",
      "Ledger impact: Debit debtors control; Credit sales/VAT",
    ].join("\n");
    if (window.confirm(summary)) moveSelected("published");
  };

  return (
    <div className="flex h-[calc(100vh-1.5rem)] min-h-[660px] flex-col overflow-hidden">
      <header className="mb-2 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Button type="button" variant="outline" onClick={backToList} className="h-8 gap-2 px-3">
            <ArrowLeft className="h-4 w-4" /> {client?.business_name || "Documents"}
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate font-display text-lg font-bold text-stone-900">Sales invoice review</h1>
              <ConfidenceBadge value={aiConfidence(row)} />
              <CodingSourceBadge context={codingContext} />
              <Badge className="bg-sky-100 text-sky-800 hover:bg-sky-100">Accounts Receivable</Badge>
              <Badge variant="secondary" className="capitalize">{row.review_status || "inbox"}</Badge>
            </div>
            <p className="truncate text-xs text-stone-500">{row.image_filename || "No file"} {row.comment ? `- ${row.comment}` : ""}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={prefillSelected} disabled={busy} className="h-8 gap-2 px-3">
            <Sparkles className="h-4 w-4" /> AI prefill
          </Button>
          <Button type="button" variant="outline" onClick={() => moveSelected("needs_clarification")} disabled={busy} className="h-8 gap-2 px-3">
            <AlertTriangle className="h-4 w-4" /> Needs clarification
          </Button>
          <Button type="button" variant="outline" onClick={() => moveSelected("archived")} disabled={busy} className="h-8 gap-2 px-3">
            <Archive className="h-4 w-4" /> Reject / archive
          </Button>
          <Button type="button" variant="outline" onClick={() => moveSelected("reviewed")} disabled={busy} className="h-8 gap-2 px-3">
            <CheckCircle2 className="h-4 w-4" /> Save review
          </Button>
          <Button type="button" onClick={publishSalesInvoice} disabled={busy} className="h-8 gap-2 px-3" style={{ background: "var(--brand)" }}>
            <CheckCircle2 className="h-4 w-4" /> Publish to Accounts Receivable
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-2 xl:grid-cols-[minmax(540px,1fr)_minmax(620px,0.95fr)]">
        <section className="min-h-0 overflow-hidden rounded-md border border-stone-200 bg-white">
          <SalesInvoiceReviewForm
            row={row}
            draft={draft}
            setDraft={setDraft}
            activeField={activeField}
            setActiveField={setActiveField}
            codingContext={codingContext}
            codingOptions={codingOptions}
            busy={busy}
          />
        </section>
        <section className="min-h-0 overflow-hidden rounded-md border border-stone-200 bg-stone-100">
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between gap-3 border-b border-stone-200 bg-white px-3 py-2">
              <div className="min-w-0">
                <div className="truncate font-semibold text-stone-900">{row.image_filename || "Source document preview"}</div>
                <div className="truncate text-xs text-stone-500">Original submitted item audit trail remains with this document</div>
              </div>
              <Badge className={row.review_status === "published" ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" : "bg-sky-100 text-sky-800 hover:bg-sky-100"}>
                {row.review_status === "published" ? "Published to Accounts Receivable" : "Sales Invoice"}
              </Badge>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {row.image_filename ? (
                <div className="relative min-h-[640px] overflow-auto rounded-md border border-stone-200 bg-white">
                  {previewUrl ? (
                    isPdfFile(row.image_filename) ? (
                      <iframe title="Submitted sales invoice PDF" src={previewUrl} className="h-[calc(100vh-9rem)] min-h-[640px] w-full rounded-md bg-white" />
                    ) : (
                      <img src={previewUrl} alt="Submitted sales invoice" className="block w-full rounded-md bg-white" />
                    )
                  ) : previewError ? (
                    <div className="flex h-full min-h-[640px] items-center justify-center p-6 text-center text-sm text-red-600">{previewError}</div>
                  ) : (
                    <div className="flex h-full min-h-[640px] items-center justify-center text-stone-500">Loading preview...</div>
                  )}
                </div>
              ) : (
                <div className="flex h-full min-h-[640px] items-center justify-center rounded-md border border-dashed border-stone-300 bg-white text-stone-500">
                  No source document attached
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function SalesInvoiceReviewForm({ row, draft, setDraft, activeField, setActiveField, codingContext, codingOptions, busy }) {
  const options = codingOptions || {};
  const lineTotals = useMemo(() => calculateLineTotals(draft.line_items), [draft.line_items]);
  const headerTotals = {
    net: parseAmount(draft.net),
    vat: parseAmount(draft.vat),
    total: parseAmount(draft.total),
  };
  const duplicateWarning = salesDuplicateWarning(row, draft);
  const set = (key, value) => setDraftValue(key, value, setDraft);
  const setLine = (index, key, value) => {
    setDraft((current) => ({
      ...current,
      line_items: current.line_items.map((line, i) => (i === index ? { ...line, [key]: value } : line)),
    }));
  };
  const addLine = () => {
    setDraft((current) => ({
      ...current,
      line_items: [
        ...current.line_items,
        { description: "", quantity: "1", unit_price: "", net: "", vat_code: "", vat: "", total: "", sales_nominal: "" },
      ],
    }));
  };
  const removeLine = (index) => {
    setDraft((current) => {
      const next = current.line_items.filter((_, i) => i !== index);
      return {
        ...current,
        line_items: next.length ? next : [{ description: "", quantity: "1", unit_price: "", net: "", vat_code: "", vat: "", total: "", sales_nominal: "" }],
      };
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-stone-200 bg-stone-50 px-3 py-2">
        <div>
          <div className="font-display text-base font-bold text-stone-900">Sales invoice review</div>
          <div className="text-xs text-stone-500">Active field: {salesFieldLabel(activeField)}</div>
        </div>
        <Badge className="bg-sky-100 text-sky-800 hover:bg-sky-100">Route: Accounts Receivable</Badge>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2.5">
        {duplicateWarning && (
          <div className="mb-2 flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{duplicateWarning}</span>
          </div>
        )}

        <ReviewSection title="Customer">
          <div className="grid gap-2 lg:grid-cols-3">
            <DatalistField id="customer_name" label="Customer name" value={draft.customer_name} options={options.customerOptions} onChange={(v) => setCustomerDraftFromOption(v, options.customerOptions, setDraft)} activeField={activeField} setActiveField={setActiveField} />
            <ConfidenceField row={row} field="customer_name" draft={draft} />
            <TextField id="customer_match_status" label="Customer match / suggested customer" value={draft.customer_match_status} onChange={(v) => set("customer_match_status", v)} activeField={activeField} setActiveField={setActiveField} />
            <label className="flex h-8 items-center gap-2 text-sm font-medium text-stone-700">
              <input type="checkbox" checked={Boolean(draft.create_new_customer)} onChange={(e) => set("create_new_customer", e.target.checked)} disabled={busy} />
              Create new customer
            </label>
            <TextField id="customer_email" label="Customer email" value={draft.customer_email} onChange={(v) => set("customer_email", v)} activeField={activeField} setActiveField={setActiveField} />
            <TextField id="customer_account_code" label="Customer reference/account code" value={draft.customer_account_code} onChange={(v) => set("customer_account_code", v)} activeField={activeField} setActiveField={setActiveField} />
          </div>
        </ReviewSection>

        <ReviewSection title="Invoice">
          <div className="grid gap-2 lg:grid-cols-4">
            <TextField id="sales_invoice_number" label="Sales invoice number" value={draft.sales_invoice_number} onChange={(v) => set("sales_invoice_number", v)} activeField={activeField} setActiveField={setActiveField} />
            <TextField id="invoice_date" label="Invoice date" value={draft.invoice_date} onChange={(v) => set("invoice_date", v)} activeField={activeField} setActiveField={setActiveField} />
            <TextField id="due_date" label="Due date" value={draft.due_date} onChange={(v) => set("due_date", v)} activeField={activeField} setActiveField={setActiveField} />
            <TextField id="payment_terms" label="Payment terms" value={draft.payment_terms} onChange={(v) => set("payment_terms", v)} activeField={activeField} setActiveField={setActiveField} />
            <TextField id="currency" label="Currency" value={draft.currency} onChange={(v) => set("currency", v)} activeField={activeField} setActiveField={setActiveField} />
            <TextField id="net" label="Net amount" value={draft.net} onChange={(v) => set("net", v)} activeField={activeField} setActiveField={setActiveField} />
            <TextField id="vat" label="VAT amount" value={draft.vat} onChange={(v) => set("vat", v)} activeField={activeField} setActiveField={setActiveField} />
            <TextField id="total" label="Gross amount" value={draft.total} onChange={(v) => set("total", v)} activeField={activeField} setActiveField={setActiveField} />
          </div>
        </ReviewSection>

        <ReviewSection title="Line coding">
          <div className="overflow-x-auto">
            <datalist id="sales-nominal-options">
              {(options.salesAccountOptions || options.categoryOptions || []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </datalist>
            <datalist id="sales-vat-options">
              {(options.vatOptions || []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </datalist>
            <table className="w-full min-w-[920px] text-xs">
              <thead className="border-b border-stone-200 text-left text-[10px] uppercase tracking-wider text-stone-500">
                <tr>
                  <th className="py-1 pr-1.5">Description</th>
                  <th className="py-1 pr-1.5">Quantity</th>
                  <th className="py-1 pr-1.5">Unit price</th>
                  <th className="py-1 pr-1.5">Net</th>
                  <th className="py-1 pr-1.5">VAT code</th>
                  <th className="py-1 pr-1.5">VAT amount</th>
                  <th className="py-1 pr-1.5">Gross</th>
                  <th className="py-1">Sales nominal/account code</th>
                  <th className="py-1 pl-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {draft.line_items.map((line, index) => (
                  <tr key={index}>
                    {["description", "quantity", "unit_price", "net", "vat_code", "vat", "total", "sales_nominal"].map((key) => (
                      <td key={key} className="py-0.5 pr-1.5">
                        <Input
                          value={line[key] || ""}
                          onChange={(e) => setLine(index, key, e.target.value)}
                          onFocus={() => setActiveField(`line_items.${index}.${key}`)}
                          list={key === "sales_nominal" ? "sales-nominal-options" : key === "vat_code" ? "sales-vat-options" : undefined}
                          className={`h-7 min-w-16 px-1.5 text-xs ${activeField === `line_items.${index}.${key}` ? "border-emerald-500 ring-2 ring-emerald-100" : ""}`}
                        />
                      </td>
                    ))}
                    <td className="py-0.5 pl-1.5 align-middle">
                      <Button type="button" variant="ghost" size="icon" onClick={() => removeLine(index)} className="h-7 w-7 text-stone-500 hover:text-red-600">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addLine} className="mt-1.5 h-7 px-2 text-xs">
            Add line item
          </Button>
          <div className="mt-1.5 grid gap-1.5 rounded-md border border-stone-200 bg-stone-50 p-1.5 md:grid-cols-3">
            <TotalComparison label="Net" lineValue={lineTotals.net} headerValue={headerTotals.net} />
            <TotalComparison label="VAT" lineValue={lineTotals.vat} headerValue={headerTotals.vat} />
            <TotalComparison label="Gross" lineValue={lineTotals.total} headerValue={headerTotals.total} />
          </div>
        </ReviewSection>

        <ReviewSection title="AI learning and review">
          <div className="grid gap-2 md:grid-cols-2">
            {["customer_name", "sales_invoice_number", "invoice_date", "due_date", "net", "vat", "total"].map((field) => (
              <AiReviewField key={field} row={row} draft={draft} field={field} />
            ))}
          </div>
        </ReviewSection>

        <ReviewSection title="Submitted item audit trail">
          <div className="space-y-1.5 text-xs text-stone-600">
            {submittedItemAuditRows(row).map((entry, index) => (
              <div key={index} className="flex items-start justify-between gap-3 rounded-md border border-stone-200 bg-stone-50 px-2 py-1.5">
                <span className="font-medium text-stone-800">{entry.action}</span>
                <span className="text-right">{entry.detail}</span>
              </div>
            ))}
          </div>
        </ReviewSection>

        {row.review_status === "published" && (
          <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            <div className="font-semibold">Published to Accounts Receivable</div>
            <div className="mt-1">
              Created sales invoice:{" "}
              {draft.ar_sales_invoice_url ? (
                <a href={draft.ar_sales_invoice_url} className="font-semibold underline">Open {draft.ar_sales_invoice_id || draft.sales_invoice_number || "sales invoice"}</a>
              ) : (
                <span className="font-semibold">{draft.ar_sales_invoice_id || draft.sales_invoice_number || "available after publish"}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewSection({ title, children }) {
  return (
    <section className="mb-2 rounded-md border border-stone-200 bg-white p-2.5">
      <h2 className="mb-2 font-display text-sm font-semibold text-stone-900">{title}</h2>
      {children}
    </section>
  );
}

function ReviewForm({ draft, setDraft, activeField, setActiveField, suggestLinesFromPattern, createSupplierFromDraft, codingContext, codingOptions, busy }) {
  const [patternLineIndex, setPatternLineIndex] = useState(0);
  const options = codingOptions || {};
  const nativeContext = codingContext?.source === "epos_native";
  const lineTotals = useMemo(() => calculateLineTotals(draft.line_items), [draft.line_items]);
  const headerTotals = {
    net: parseAmount(draft.net),
    vat: parseAmount(draft.vat),
    total: parseAmount(draft.total),
  };
  const set = (key, value) => setDraftValue(key, value, setDraft);
  const setLine = (index, key, value) => {
    setDraft((current) => ({
      ...current,
      line_items: current.line_items.map((line, i) => (i === index ? { ...line, [key]: value } : line)),
    }));
  };
  const addLine = () => {
    setDraft((current) => ({
      ...current,
      line_items: [
        ...current.line_items,
        { description: "", category: "", vat_code: "", units: "1", price: "", net: "", vat: "", total: "" },
      ],
    }));
  };
  const clearLines = () => {
    setPatternLineIndex(0);
    setDraft((current) => ({
      ...current,
      line_items: [{ description: "", category: "", vat_code: "", units: "1", price: "", net: "", vat: "", total: "" }],
    }));
  };
  const removeLine = (index) => {
    setDraft((current) => {
      const next = current.line_items.filter((_, i) => i !== index);
      return {
        ...current,
        line_items: next.length ? next : [{ description: "", category: "", vat_code: "", units: "1", price: "", net: "", vat: "", total: "" }],
      };
    });
    setPatternLineIndex((current) => Math.max(0, Math.min(current, draft.line_items.length - 2)));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-stone-200 bg-stone-50 px-3 py-2">
        <div>
          <div className="font-display text-base font-bold text-stone-900">Coding fields</div>
          <div className="text-xs text-stone-500">Active field: {fieldLabel(activeField)}</div>
        </div>
        <Badge variant="secondary">{draft.currency || "GBP"}</Badge>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2.5">
        <div className="grid gap-2 lg:grid-cols-3">
          <DatalistField id="vendor_name" label="Vendor Name" value={draft.vendor_name} options={options.supplierOptions} onChange={(v) => setSupplierDraftFromOption(v, options.supplierOptions, setDraft)} activeField={activeField} setActiveField={setActiveField} />
          <div>
            <Label className="text-xs font-semibold text-stone-700">Type</Label>
            <div className="mt-1 flex h-8 items-center gap-3 text-sm">
              <label className="flex items-center gap-2"><input type="radio" checked={draft.document_type === "bill"} onChange={() => set("document_type", "bill")} /> Bill</label>
              <label className="flex items-center gap-2"><input type="radio" checked={draft.document_type === "credit_note"} onChange={() => set("document_type", "credit_note")} /> Credit Note</label>
            </div>
          </div>
          <TextField id="bill_number" label="Bill #" value={draft.bill_number} onChange={(v) => set("bill_number", v)} activeField={activeField} setActiveField={setActiveField} />
          <div className="lg:col-span-3 -mt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={createSupplierFromDraft}
              disabled={busy || !String(draft.vendor_name || "").trim() || supplierExists(draft.vendor_name, options.supplierOptions)}
              className="h-8"
            >
              Create missing supplier
            </Button>
            {!options.supplierOptions?.length && (
              <span className="ml-3 text-xs text-stone-500">{nativeContext ? "No EPOS Native AP suppliers found for this client yet." : "No external suppliers synced for this client yet."}</span>
            )}
          </div>
          <DatalistField id="category" label="Category" value={draft.category} options={options.categoryOptions} onChange={(v) => set("category", v)} activeField={activeField} setActiveField={setActiveField} />
          <TextField id="reference" label="Reference" value={draft.reference} onChange={(v) => set("reference", v)} activeField={activeField} setActiveField={setActiveField} />
          <TextField id="date" label="Date" value={draft.date} onChange={(v) => set("date", v)} activeField={activeField} setActiveField={setActiveField} />
          <TextField id="due_date" label="Due Date" value={draft.due_date} onChange={(v) => set("due_date", v)} activeField={activeField} setActiveField={setActiveField} />
          <TextField id="payment_method" label="Payment Method" value={draft.payment_method} onChange={(v) => set("payment_method", v)} activeField={activeField} setActiveField={setActiveField} />
          <TextField id="currency" label="Currency" value={draft.currency} onChange={(v) => set("currency", v)} activeField={activeField} setActiveField={setActiveField} />
        </div>

        <div className="mt-2">
          <TextField id="description" label="Description" value={draft.description} onChange={(v) => set("description", v)} activeField={activeField} setActiveField={setActiveField} />
        </div>

        <div className="mt-2 grid gap-2 border-t border-stone-200 pt-2 lg:grid-cols-4">
          <TextField id="net" label="Net" value={draft.net} onChange={(v) => set("net", v)} activeField={activeField} setActiveField={setActiveField} />
          <TextField id="vat" label="VAT" value={draft.vat} onChange={(v) => set("vat", v)} activeField={activeField} setActiveField={setActiveField} />
          <TextField id="total" label="Total" value={draft.total} onChange={(v) => set("total", v)} activeField={activeField} setActiveField={setActiveField} />
          <DatalistField id="vat_code" label="VAT Code" value={draft.vat_code} options={options.vatOptions} onChange={(v) => set("vat_code", v)} activeField={activeField} setActiveField={setActiveField} />
          <label className="flex h-8 items-center gap-2 text-sm font-medium text-stone-700">
            <input type="checkbox" checked={draft.mark_as_paid} onChange={(e) => set("mark_as_paid", e.target.checked)} />
            Mark as Paid
          </label>
          {draft.mark_as_paid && (
            <DatalistField id="bank_account" label="Bank account" value={draft.bank_account} options={options.bankAccountOptions} onChange={(v) => set("bank_account", v)} activeField={activeField} setActiveField={setActiveField} />
          )}
        </div>

        <div className="mt-2 border-t border-stone-200 pt-2">
          <div className="mb-1.5 flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
            <div className="font-display text-sm font-semibold text-stone-900">Line Items ({draft.line_items.length})</div>
            <div className="flex flex-wrap gap-2">
              <select className="h-7 rounded-md border border-stone-200 bg-white px-2 text-xs" value={draft.price_is} onChange={(e) => set("price_is", e.target.value)}>
                <option>Tax Exclusive</option>
                <option>Tax Inclusive</option>
              </select>
              <Button type="button" variant="outline" size="sm" onClick={clearLines} className="h-7 gap-1.5 px-2 text-xs">
                <RotateCcw className="h-3.5 w-3.5" /> Clear
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => suggestLinesFromPattern(draft.line_items[patternLineIndex])}
                disabled={busy}
                className="h-7 gap-1.5 px-2 text-xs"
              >
                <Wand2 className="h-3.5 w-3.5" /> Suggest from pattern
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <datalist id="line-category-options">
              {(options.categoryOptions || []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </datalist>
            <datalist id="line-vat-options">
              {(options.vatOptions || []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </datalist>
            <table className="w-full min-w-[840px] text-xs">
              <thead className="border-b border-stone-200 text-left text-[10px] uppercase tracking-wider text-stone-500">
                <tr>
                  <th className="py-1 pr-1.5">Pattern</th>
                  <th className="py-1 pr-1.5">Description</th>
                  <th className="py-1 pr-1.5">Category</th>
                  <th className="py-1 pr-1.5">VAT Code</th>
                  <th className="py-1 pr-1.5">Units</th>
                  <th className="py-1 pr-1.5">Price</th>
                  <th className="py-1 pr-1.5">Net</th>
                  <th className="py-1 pr-1.5">VAT</th>
                  <th className="py-1">Total</th>
                  <th className="py-1 pl-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {draft.line_items.map((line, index) => (
                  <tr key={index}>
                    <td className="py-0.5 pr-1.5 align-middle">
                      <input
                        type="radio"
                        name="line-pattern"
                        checked={patternLineIndex === index}
                        onChange={() => setPatternLineIndex(index)}
                        className="h-3.5 w-3.5"
                        title="Use this line as the pattern"
                      />
                    </td>
                    {["description", "category", "vat_code", "units", "price", "net", "vat", "total"].map((key) => (
                      <td key={key} className="py-0.5 pr-1.5">
                        <Input
                          value={line[key]}
                          onChange={(e) => setLine(index, key, e.target.value)}
                          onFocus={() => setActiveField(`line_items.${index}.${key}`)}
                          list={key === "category" ? "line-category-options" : key === "vat_code" ? "line-vat-options" : undefined}
                          className={`h-7 min-w-16 px-1.5 text-xs ${activeField === `line_items.${index}.${key}` ? "border-emerald-500 ring-2 ring-emerald-100" : ""}`}
                        />
                      </td>
                    ))}
                    <td className="py-0.5 pl-1.5 align-middle">
                      <Button type="button" variant="ghost" size="icon" onClick={() => removeLine(index)} className="h-7 w-7 text-stone-500 hover:text-red-600">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addLine} className="mt-1.5 h-7 px-2 text-xs">
            Add line item
          </Button>
          <div className="mt-1.5 grid gap-1.5 rounded-md border border-stone-200 bg-stone-50 p-1.5 md:grid-cols-3">
            <TotalComparison label="Net" lineValue={lineTotals.net} headerValue={headerTotals.net} />
            <TotalComparison label="VAT" lineValue={lineTotals.vat} headerValue={headerTotals.vat} />
            <TotalComparison label="Total" lineValue={lineTotals.total} headerValue={headerTotals.total} />
          </div>
        </div>
      </div>
    </div>
  );
}

function TotalComparison({ label, lineValue, headerValue }) {
  const hasHeader = Number.isFinite(headerValue);
  const diff = hasHeader ? lineValue - headerValue : null;
  const matched = diff !== null && Math.abs(diff) < 0.01;
  const diffClass = !hasHeader
    ? "text-stone-500"
    : matched
      ? "text-emerald-700"
      : "text-amber-700";
  return (
    <div className="rounded-md border border-stone-200 bg-white px-2 py-1.5 text-xs">
      <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <span className="text-stone-600">Lines</span>
        <span className="font-semibold text-stone-900">{formatMoney(lineValue)}</span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <span className="text-stone-600">Header</span>
        <span className="font-semibold text-stone-900">{hasHeader ? formatMoney(headerValue) : "-"}</span>
      </div>
      <div className={`mt-0.5 flex items-center justify-between gap-2 ${diffClass}`}>
        <span>Difference</span>
        <span className="font-semibold">{diff === null ? "-" : formatMoney(diff)}</span>
      </div>
    </div>
  );
}

function TextField({ id, label, value, onChange, activeField, setActiveField }) {
  const active = activeField === id;
  return (
    <div>
      <Label className="text-xs font-semibold text-stone-700">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setActiveField(id)}
        className={`mt-0.5 h-8 px-2 text-sm ${active ? "border-emerald-500 ring-2 ring-emerald-100" : ""}`}
      />
    </div>
  );
}

function DatalistField({ id, label, value, options = [], onChange, activeField, setActiveField }) {
  const active = activeField === id;
  const listId = `${id}-options`;
  return (
    <div>
      <Label className="text-xs font-semibold text-stone-700">{label}</Label>
      <Input
        value={value || ""}
        list={listId}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setActiveField(id)}
        className={`mt-0.5 h-8 px-2 text-sm ${active ? "border-emerald-500 ring-2 ring-emerald-100" : ""}`}
      />
      <datalist id={listId}>
        {options.map((option) => <option key={option.value} value={option.value} label={option.label}>{option.label}</option>)}
      </datalist>
    </div>
  );
}

function ConfidenceBadge({ value }) {
  if (value === null || value === undefined || value === "") return <Badge variant="secondary">AI confidence -</Badge>;
  const score = Number(value);
  if (!Number.isFinite(score)) return <Badge variant="secondary">AI confidence -</Badge>;
  const tone = score >= 85
    ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100"
    : score >= 65
      ? "bg-amber-100 text-amber-800 hover:bg-amber-100"
      : "bg-red-100 text-red-800 hover:bg-red-100";
  return <Badge className={tone}>AI confidence {Math.round(score)}%</Badge>;
}

function ConfidenceField({ row, field, draft }) {
  const confidence = aiFieldConfidence(row, field);
  const corrected = isCorrectedField(row, draft, field);
  if (confidence === null && !corrected) return null;
  return (
    <div className="flex h-8 items-center gap-2 text-xs">
      {confidence !== null && <ConfidenceBadge value={confidence} />}
      {corrected && <Badge className="bg-violet-100 text-violet-800 hover:bg-violet-100">Corrected for learning</Badge>}
    </div>
  );
}

function AiReviewField({ row, draft, field }) {
  const confidence = aiFieldConfidence(row, field);
  const corrected = isCorrectedField(row, draft, field);
  const lowConfidence = confidence !== null && confidence < 70;
  return (
    <div className={`rounded-md border p-2 text-xs ${corrected ? "border-violet-200 bg-violet-50" : lowConfidence ? "border-amber-200 bg-amber-50" : "border-stone-200 bg-stone-50"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-stone-800">{salesFieldLabel(field)}</span>
        {confidence !== null ? <span className={lowConfidence ? "font-semibold text-amber-700" : "text-stone-500"}>{Math.round(confidence)}%</span> : <span className="text-stone-400">-</span>}
      </div>
      <div className="mt-1 truncate text-stone-600">Extracted: {String(extractedFieldValue(row, field) || "-")}</div>
      <div className="mt-0.5 truncate text-stone-600">Reviewed: {String(draft[field] || "-")}</div>
      {corrected && <div className="mt-1 font-medium text-violet-700">User correction captured as learning feedback</div>}
      {lowConfidence && !corrected && <div className="mt-1 font-medium text-amber-700">Low confidence: review before publishing</div>}
    </div>
  );
}

function makeDraft(row) {
  const amount = row?.amount || "";
  const description = row?.description || "";
  const suggested = cleanCodingFields(row?.coding_fields) || cleanCodingFields(row?.ai_extracted_fields) || {};
  const lineItems = Array.isArray(suggested.line_items) && suggested.line_items.length > 0
    ? suggested.line_items
    : [{
        description,
        category: "",
        sales_nominal: "",
        vat_code: "",
        units: "1",
        quantity: "1",
        price: amount,
        unit_price: amount,
        net: amount,
        vat: "",
        total: amount,
      }];
  const base = {
    vendor_name: row?.client_business_name || row?.client?.business_name || "",
    vendor_account: "",
    supplier_id: "",
    supplier_code: "",
    category: "",
    date: row?.date || "",
    due_date: row?.date || "",
    description,
    document_type: "bill",
    bill_number: "",
    reference: "",
    net: amount,
    vat: "",
    total: amount,
    vat_code: "",
    currency: "GBP",
    payment_method: paymentMethodLabel(row?.ai_payment_method),
    mark_as_paid: false,
    bank_account: "",
    price_is: "Tax Exclusive",
    customer_name: "",
    customer_id: "",
    customer_match_status: "",
    create_new_customer: false,
    customer_email: "",
    customer_account_code: "",
    sales_invoice_number: "",
    invoice_date: row?.date || "",
    payment_terms: "",
    ar_sales_invoice_id: "",
    ar_sales_invoice_url: "",
  };
  return reconcileDraftTotals({
    ...base,
    ...suggested,
    vendor_name: suggested.vendor_name || row?.client_business_name || row?.client?.business_name || "",
    supplier_id: suggested.supplier_id || suggested.vendor_id || "",
    supplier_code: suggested.supplier_code || suggested.vendor_account || "",
    description: suggested.description || description,
    date: suggested.date || row?.date || "",
    due_date: suggested.due_date || suggested.date || row?.date || "",
    net: suggested.net || amount,
    total: suggested.total || amount,
    currency: suggested.currency || "GBP",
    payment_method: displayPaymentMethod(suggested.payment_method) || paymentMethodLabel(row?.ai_payment_method),
    document_type: suggested.document_type || (submittedDocumentFlow(row) === "sales" ? "sales_invoice" : "bill"),
    customer_name: suggested.customer_name || suggested.customer || suggested.client_name || "",
    customer_id: suggested.customer_id || "",
    customer_match_status: suggested.customer_match_status || suggested.suggested_customer || "",
    create_new_customer: Boolean(suggested.create_new_customer),
    customer_email: suggested.customer_email || suggested.email || "",
    customer_account_code: suggested.customer_account_code || suggested.customer_reference || suggested.customer_account || "",
    sales_invoice_number: suggested.sales_invoice_number || suggested.invoice_number || suggested.bill_number || "",
    invoice_date: suggested.invoice_date || suggested.date || row?.date || "",
    payment_terms: suggested.payment_terms || "",
    ar_sales_invoice_id: suggested.ar_sales_invoice_id || suggested.accounts_receivable_invoice_id || "",
    ar_sales_invoice_url: suggested.ar_sales_invoice_url || suggested.accounts_receivable_invoice_url || "",
    ocr_text_lines: Array.isArray(suggested.ocr_text_lines) ? suggested.ocr_text_lines : [],
    ocr_text_boxes: Array.isArray(suggested.ocr_text_boxes) ? suggested.ocr_text_boxes : [],
    line_items: lineItems.map((line) => ({
      description: line.description || "",
      category: line.category || "",
      sales_nominal: line.sales_nominal || line.sales_account || line.category || "",
      vat_code: line.vat_code || "",
      units: line.units || "1",
      quantity: line.quantity || line.units || "1",
      price: line.price || "",
      unit_price: line.unit_price || line.price || "",
      net: line.net || "",
      vat: line.vat || "",
      total: line.total || "",
    })),
  });
}

function setDraftValue(key, value, setDraft) {
  setDraft((current) => {
    if (String(key || "").startsWith("line_items.")) {
      const [, indexValue, lineKey] = String(key).split(".");
      const index = Number(indexValue);
      if (!Number.isInteger(index) || !lineKey) return current;
      const existingLines = Array.isArray(current.line_items) ? current.line_items : [];
      return {
        ...current,
        line_items: existingLines.map((line, i) => (i === index ? { ...line, [lineKey]: value } : line)),
      };
    }
    return { ...current, [key]: value };
  });
}

function getNextRowId(rows, selectedId) {
  if (!Array.isArray(rows) || rows.length <= 1) return "";
  const index = rows.findIndex((row) => row.id === selectedId);
  if (index < 0) return "";
  return rows[index + 1]?.id || rows[index - 1]?.id || "";
}

function calculateLineTotals(lineItems = []) {
  return lineItems.reduce((totals, line) => {
    totals.net += parseAmount(line.net) || 0;
    totals.vat += parseAmount(line.vat) || 0;
    totals.total += parseAmount(line.total) || 0;
    return totals;
  }, { net: 0, vat: 0, total: 0 });
}

function parseAmount(value) {
  const match = String(value || "").replace(/,/g, "").match(/-?\d+(?:\.\d{1,2})?/);
  return match ? Number(match[0]) : null;
}

function formatAmount(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "";
}

function formatMoney(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function submittedDocumentFlow(row) {
  const text = [
    row?.document_type,
    row?.type,
    row?.ai_document_type,
    row?.coding_fields?.document_type,
    row?.ai_extracted_fields?.document_type,
    row?.description,
    row?.comment,
  ].filter(Boolean).join(" ").toLowerCase();
  if (/\bsales[ _-]*invoice\b/.test(text) || /\bar[ _-]*invoice\b/.test(text) || /\bcustomer invoice\b/.test(text)) return "sales";
  if (/\bpurchase[ _-]*invoice\b/.test(text) || /\bbill\b/.test(text) || /\bsupplier invoice\b/.test(text) || /\bap[ _-]*invoice\b/.test(text)) return "purchase";
  return "unclassified";
}

function submittedDocumentTypeLabel(row) {
  const flow = submittedDocumentFlow(row);
  if (flow === "sales") return "Sales Invoice";
  if (flow === "purchase") return "Purchase Invoice";
  return "Unclassified";
}

function aiConfidence(row) {
  const raw = row?.ai_confidence
    ?? row?.confidence
    ?? row?.ai_review?.confidence
    ?? row?.ai_extracted_fields?.confidence
    ?? row?.coding_fields?.confidence;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return value <= 1 ? value * 100 : value;
}

function aiFieldConfidence(row, field) {
  const confidence = row?.ai_field_confidence
    || row?.field_confidence
    || row?.ai_review?.field_confidence
    || row?.ai_extracted_fields?.field_confidence
    || row?.coding_fields?.field_confidence
    || {};
  const raw = confidence[field] ?? confidence[salesFieldAlias(field)];
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return value <= 1 ? value * 100 : value;
}

function salesFieldAlias(field) {
  const aliases = {
    customer_name: "customer",
    sales_invoice_number: "invoice_number",
    invoice_date: "date",
    total: "gross",
  };
  return aliases[field] || field;
}

function extractedFieldValue(row, field) {
  const source = cleanCodingFields(row?.ai_extracted_fields) || {};
  return source[field] ?? source[salesFieldAlias(field)] ?? "";
}

function isCorrectedField(row, draft, field) {
  const extracted = String(extractedFieldValue(row, field) || "").trim();
  const reviewed = String(draft?.[field] || "").trim();
  return !!extracted && !!reviewed && extracted !== reviewed;
}

function salesDuplicateWarning(row, draft) {
  const duplicate = row?.duplicate_warning || row?.ai_extracted_fields?.duplicate_warning || row?.coding_fields?.duplicate_warning;
  if (duplicate) return String(duplicate);
  if (draft?.duplicate_invoice_warning) return String(draft.duplicate_invoice_warning);
  return "";
}

function salesCustomerMatchStatus(row) {
  const fields = cleanCodingFields(row?.coding_fields) || cleanCodingFields(row?.ai_extracted_fields) || {};
  return fields.customer_match_status || fields.suggested_customer || fields.customer_name || "Needs review";
}

function submittedItemAuditRows(row) {
  const history = Array.isArray(row?.audit_trail) ? row.audit_trail : Array.isArray(row?.review_history) ? row.review_history : [];
  if (history.length) {
    return history.map((entry) => ({
      action: entry.action || entry.status || "Activity",
      detail: [formatDateTime(entry.date || entry.created_at || entry.timestamp), entry.user || entry.actor, entry.description || entry.detail]
        .filter(Boolean)
        .join(" - "),
    }));
  }
  return [
    { action: "Submitted", detail: formatDateTime(row?.submitted_at) },
    { action: "Review status", detail: row?.review_status || "inbox" },
    { action: "Route", detail: "Accounts Receivable after publish" },
  ];
}

function reconcileDraftTotals(draft) {
  const next = {
    ...draft,
    line_items: Array.isArray(draft.line_items) ? draft.line_items.map((line) => ({ ...line })) : [],
  };
  const total = parseAmount(next.total);
  const vat = parseAmount(next.vat);
  const net = parseAmount(next.net);
  if (net === null && total !== null) {
    next.net = vat !== null ? formatAmount(total - vat) : formatAmount(total);
  }
  if (total === null && net !== null) {
    next.total = vat !== null ? formatAmount(net + vat) : formatAmount(net);
  }

  next.line_items = next.line_items.map((line) => {
    const lineTotal = parseAmount(line.total);
    const lineVat = parseAmount(line.vat);
    const lineNet = parseAmount(line.net);
    const updated = { ...line };
    if (lineNet === null && lineTotal !== null) {
      updated.net = lineVat !== null ? formatAmount(lineTotal - lineVat) : formatAmount(lineTotal);
    }
    if (lineTotal === null && lineNet !== null) {
      updated.total = lineVat !== null ? formatAmount(lineNet + lineVat) : formatAmount(lineNet);
    }
    if (!String(updated.price || "").trim()) {
      updated.price = updated.net || updated.total || "";
    }
    return updated;
  });

  if (next.line_items.length === 1) {
    next.line_items[0] = {
      ...next.line_items[0],
      net: next.net || next.line_items[0].net,
      vat: next.vat || next.line_items[0].vat,
      total: next.total || next.line_items[0].total,
      price: next.line_items[0].price || next.net || next.total,
    };
  }
  return next;
}

function statusGroup(status) {
  if (status === "archived" || status === "published") return "archived";
  return "inbox";
}

function formatDateTime(value) {
  if (!value) return "Not dated";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function isPdfFile(filename) {
  return filename?.toLowerCase().endsWith(".pdf");
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "submissions";
}

function paymentMethodLabel(value) {
  if (value === "card") return "Card";
  if (value === "cash") return "Cash";
  if (value === "payment_terms") return "Payment terms";
  return "Not clear";
}

function displayPaymentMethod(value) {
  if (!value) return "";
  const normal = String(value).toLowerCase().replace(/[_-]+/g, " ");
  if (normal === "card") return "Card";
  if (normal === "cash") return "Cash";
  if (normal === "payment terms" || normal === "bank transfer") return "Payment terms";
  if (normal === "not clear" || normal === "not_clear") return "Not clear";
  return String(value);
}

function cleanCodingFields(value) {
  if (!value || typeof value !== "object") return null;
  const hasOcrValue = Array.isArray(value.ocr_text_lines) && value.ocr_text_lines.some((line) => String(line || "").trim());
  const hasOcrBoxValue = Array.isArray(value.ocr_text_boxes) && value.ocr_text_boxes.some((box) => String(box?.text || "").trim());
  const hasHeaderValue = [
    "vendor_name",
    "vendor_account",
    "customer_name",
    "customer_email",
    "customer_account_code",
    "customer_match_status",
    "category",
    "sales_nominal",
    "date",
    "invoice_date",
    "due_date",
    "bill_number",
    "sales_invoice_number",
    "reference",
    "net",
    "vat",
    "total",
    "vat_code",
    "currency",
    "payment_method",
    "bank_account",
  ].some((key) => String(value[key] || "").trim());
  const hasLineValue = Array.isArray(value.line_items)
    && value.line_items.some((line) => line && Object.values(line).some((item) => String(item || "").trim()));
  if (!hasHeaderValue && !hasLineValue && !hasOcrValue && !hasOcrBoxValue) return null;
  return value;
}

function fieldLabel(key) {
  if (String(key || "").startsWith("line_items.")) {
    const [, indexValue, lineKey] = String(key).split(".");
    const lineNumber = Number(indexValue) + 1;
    return `Line ${Number.isFinite(lineNumber) ? lineNumber : ""} ${fieldLabel(lineKey)}`.trim();
  }
  const labels = {
    vendor_name: "Vendor Name",
    vendor_account: "Vendor A/C",
    category: "Category",
    bill_number: "Bill #",
    reference: "Reference",
    date: "Date",
    due_date: "Due Date",
    description: "Description",
    net: "Net",
    vat: "VAT",
    total: "Total",
    vat_code: "VAT Code",
    currency: "Currency",
    payment_method: "Payment Method",
    bank_account: "Bank account",
  };
  return labels[key] || key;
}

function salesFieldLabel(key) {
  if (String(key || "").startsWith("line_items.")) {
    const [, indexValue, lineKey] = String(key).split(".");
    const lineNumber = Number(indexValue) + 1;
    return `Line ${Number.isFinite(lineNumber) ? lineNumber : ""} ${salesFieldLabel(lineKey)}`.trim();
  }
  const labels = {
    customer_name: "Customer name",
    customer_match_status: "Customer match",
    customer_email: "Customer email",
    customer_account_code: "Customer reference/account code",
    sales_invoice_number: "Sales invoice number",
    invoice_date: "Invoice date",
    due_date: "Due date",
    payment_terms: "Payment terms",
    description: "Description",
    quantity: "Quantity",
    unit_price: "Unit price",
    sales_nominal: "Sales nominal/account code",
    net: "Net amount",
    vat: "VAT amount",
    total: "Gross amount",
    vat_code: "VAT code",
    currency: "Currency",
  };
  return labels[key] || key;
}

function buildCodingContextOptions(context = {}) {
  const native = context.source === "epos_native";
  const supplierOptions = uniqueOptions((context.suppliers || []).map((record) => ({
    value: native ? record.supplier_id || record.id || record._id || "" : record.supplier_id || record.external_id || record.id || record.name || "",
    label: [record.supplier_code || record.code, record.name].filter(Boolean).join(" - ") || record.name || record.supplier_id || record.external_id || "",
    supplier_id: record.supplier_id || record.id || record._id || "",
    supplier_name: record.name || "",
    supplier_code: record.supplier_code || record.code || "",
    external_id: record.external_id || "",
  })));
  const supplierAccountOptions = uniqueOptions((context.suppliers || []).map((record) => ({
    value: record.supplier_code || record.code || record.supplier_id || record.id || record.external_id || "",
    label: [record.supplier_code || record.code, record.name].filter(Boolean).join(" - ") || record.name || "",
  })));
  const categoryOptions = uniqueOptions((context.purchase_accounts || []).map(accountOption));
  const customerOptions = uniqueOptions((context.customers || []).map((record) => ({
    value: native ? record.customer_id || record.id || record._id || "" : record.customer_id || record.external_id || record.id || record.name || "",
    label: [record.customer_code || record.code, record.name].filter(Boolean).join(" - ") || record.name || record.customer_id || record.external_id || "",
    customer_id: record.customer_id || record.id || record._id || "",
    customer_name: record.name || "",
    customer_code: record.customer_code || record.code || "",
    external_id: record.external_id || "",
  })));
  const salesAccountOptions = uniqueOptions((context.sales_accounts || []).map(accountOption));
  const bankAccountOptions = uniqueOptions((context.bank_accounts || []).map((record) => ({
    value: record.code || record.account_code || record.nominal_code || record.bank_account_id || record.id || "",
    label: [record.code || record.account_code || record.nominal_code, record.name].filter(Boolean).join(" - ") || record.name || record.code || "",
  })));
  const syncedVatOptions = uniqueOptions((context.vat_codes || []).map((record) => ({
    value: record.code || record.vat_code || record.id || "",
    label: [record.code || record.vat_code, record.name || record.description || record.rate].filter(Boolean).join(" - ") || record.code || record.vat_code || "",
  })));
  return {
    supplierOptions,
    supplierAccountOptions,
    customerOptions,
    categoryOptions,
    salesAccountOptions,
    bankAccountOptions,
    vatOptions: syncedVatOptions,
    vatSource: context.source || "",
  };
}

function accountOption(record = {}) {
  return {
    value: record.code || record.account_code || record.nominal_code || record.id || "",
    label: [record.code || record.account_code || record.nominal_code, record.name || record.description].filter(Boolean).join(" - ") || record.name || record.code || "",
  };
}

function CodingSourceBadge({ context }) {
  if (!context?.source) return null;
  return <Badge variant="secondary">{codingProviderLabel(context)}</Badge>;
}

function codingProviderLabel(context = {}) {
  if (context.source === "epos_native") return "EPOS Native";
  return context.provider || context.destination || "External";
}

function setSupplierDraftFromOption(value, options = [], setDraft) {
  const option = options.find((item) => item.value === value || item.label === value);
  setDraft((current) => ({
    ...current,
    supplier_id: option?.supplier_id || current.supplier_id || "",
    supplier_code: option?.supplier_code || current.supplier_code || "",
    vendor_account: option?.supplier_code || current.vendor_account || "",
    vendor_name: option?.supplier_name || value,
  }));
}

function setCustomerDraftFromOption(value, options = [], setDraft) {
  const option = options.find((item) => item.value === value || item.label === value);
  setDraft((current) => ({
    ...current,
    customer_id: option?.customer_id || current.customer_id || "",
    customer_account_code: option?.customer_code || current.customer_account_code || "",
    customer_name: option?.customer_name || value,
    customer_match_status: option ? "Matched" : current.customer_match_status,
  }));
}

function uniqueOptions(options) {
  const seen = new Set();
  return options
    .map((option) => ({
      ...option,
      value: String(option.value || "").trim(),
      label: String(option.label || option.value || "").trim(),
    }))
    .filter((option) => {
      if (!option.value) return false;
      const key = option.value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function supplierExists(value, options = []) {
  const needle = String(value || "").trim().toLowerCase();
  return !!needle && options.some((option) => [
    option.value,
    option.label,
    option.supplier_id,
    option.supplier_name,
    option.supplier_code,
  ].some((candidate) => String(candidate || "").trim().toLowerCase() === needle));
}
