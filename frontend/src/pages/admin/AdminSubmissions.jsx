import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError, API } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Archive, ArrowLeft, CheckCircle2, Download, FileText, Inbox, RotateCcw, Search, Sparkles, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";

const listTabs = [
  { key: "inbox", label: "Inbox", icon: Inbox },
  { key: "archived", label: "Archived", icon: Archive },
];

export default function AdminSubmissions() {
  const [clients, setClients] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [q, setQ] = useState("");
  const [view, setView] = useState("clients");
  const [clientId, setClientId] = useState("");
  const [tab, setTab] = useState("inbox");
  const [selectedId, setSelectedId] = useState("");
  const [selectedArchiveIds, setSelectedArchiveIds] = useState([]);
  const [draft, setDraft] = useState(makeDraft(null));
  const [activeField, setActiveField] = useState("vendor_name");
  const [previewObjectUrl, setPreviewObjectUrl] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [busy, setBusy] = useState(false);
  const [moduleDisabled, setModuleDisabled] = useState(false);
  const [integrationRecords, setIntegrationRecords] = useState({});

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

  const selected = rows.find((row) => row.id === selectedId) || null;
  const previewUrl = previewObjectUrl;
  const integrationOptions = useMemo(() => buildIntegrationOptions(integrationRecords), [integrationRecords]);

  useEffect(() => {
    setSelectedArchiveIds([]);
    setSelectedId("");
  }, [clientId, tab]);

  useEffect(() => {
    setIntegrationRecords({});
  }, [clientId]);

  useEffect(() => {
    if (!clientId) return undefined;
    let cancelled = false;
    api.get(`/admin/integrations/clients/${clientId}`)
      .then(({ data }) => {
        if (!cancelled) setIntegrationRecords(data?.records || {});
      })
      .catch(() => {
        if (!cancelled) setIntegrationRecords({});
      });
    return () => { cancelled = true; };
  }, [clientId]);

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

  async function moveSelected(reviewStatus) {
    if (!selected) return;
    setBusy(true);
    try {
      const { data } = await api.patch(`/admin/submissions/${selected.id}/review-status`, { review_status: reviewStatus, coding_fields: draft });
      if (reviewStatus === "published" && data?.memory_updated) {
        toast.success("Published and future AI examples updated");
      } else {
        toast.success(reviewStatus === "published" ? "Published to archive" : "Submission updated");
      }
      await load();
      setView("items");
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
    setBusy(true);
    try {
      await api.post(`/admin/integrations/clients/${clientId}/records`, {
        record_type: "supplier",
        name: supplierName,
        code: String(draft.vendor_account || "").trim(),
        external_id: "",
        email: null,
        description: "Created from invoice review",
        active: true,
      });
      const { data } = await api.get(`/admin/integrations/clients/${clientId}`);
      setIntegrationRecords(data?.records || {});
      toast.success("Supplier added to this client profile");
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
          integrationOptions={integrationOptions}
          busy={busy}
        />
      )}
    </div>
  );
}

function ClientsLayer({ clients, counts, q, setQ, openClient }) {
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-stone-900">Submitted items</h1>
          <p className="mt-1 text-stone-600">Open a client inbox or archive to review submitted invoices and receipts.</p>
        </div>
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <Input placeholder="Search clients" value={q} onChange={(e) => setQ(e.target.value)} className="h-11 pl-10" />
        </div>
      </header>

      {clients.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 bg-white p-12 text-center text-stone-500">
          No submitted items yet.
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {clients.map((client) => {
            const count = counts[client._id] || { inbox: 0, archived: 0 };
            return (
              <div key={client._id} className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-display text-lg font-semibold text-stone-900">{client.business_name}</div>
                    <div className="text-sm text-stone-500">{client.first_name} {client.last_name}</div>
                  </div>
                  <Badge variant={client.status === "active" ? "default" : "secondary"} className={client.status === "active" ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" : ""}>
                    {client.status}
                  </Badge>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => openClient(client, "inbox")}
                    className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-left hover:border-amber-300"
                  >
                    <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">Inbox</div>
                    <div className="font-display text-3xl font-bold text-amber-700">{count.inbox || 0}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => openClient(client, "archived")}
                    className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-left hover:border-stone-300"
                  >
                    <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">Archived</div>
                    <div className="font-display text-3xl font-bold text-stone-700">{count.archived || 0}</div>
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
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
  backToClients,
  openDocument,
  selectedArchiveIds,
  toggleArchiveSelection,
  downloadArchive,
  busy,
}) {
  return (
    <div className="flex h-[calc(100vh-3rem)] min-h-[720px] flex-col overflow-hidden">
      <header className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" onClick={backToClients} className="h-10 gap-2">
            <ArrowLeft className="h-4 w-4" /> Clients
          </Button>
          <div>
            <h1 className="font-display text-2xl font-bold text-stone-900">{client?.business_name || "Client"}</h1>
            <p className="text-sm text-stone-500">{rows.length} {rows.length === 1 ? "document" : "documents"} in {tab}</p>
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
                className="h-10 gap-2"
                style={active ? { background: "var(--brand)" } : undefined}
              >
                <Icon className="h-4 w-4" /> {item.label}
              </Button>
            );
          })}
          {tab === "archived" && (
            <Button type="button" variant="outline" onClick={downloadArchive} disabled={busy || selectedArchiveIds.length === 0} className="h-10 gap-2">
              <Download className="h-4 w-4" /> Download selected
            </Button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
            <tr>
              {tab === "archived" && <th className="w-12 px-4 py-3"></th>}
              <th className="px-4 py-3">Document</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Submitted</th>
              <th className="px-4 py-3">AI</th>
              <th className="px-4 py-3">Comment</th>
              <th className="px-4 py-3 text-right">Open</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-4 py-12 text-center text-stone-500" colSpan={tab === "archived" ? 7 : 6}>No documents here.</td>
              </tr>
            ) : rows.map((row) => (
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
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <FileText className="h-4 w-4 text-stone-500" />
                    <div>
                      <div className="font-semibold text-stone-900">{row.description || "Submitted document"}</div>
                      <div className="text-xs text-stone-500">{row.image_filename || "No file"}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3"><Badge variant="secondary" className="capitalize">{row.type}</Badge></td>
                <td className="px-4 py-3 text-stone-600">{formatDateTime(row.submitted_at)}</td>
                <td className="px-4 py-3">
                  {row.ai_review_status === "approved" && <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Checked</Badge>}
                  {row.ai_client_approved && <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">Client approved</Badge>}
                  {!row.ai_review_status && !row.ai_client_approved && <span className="text-stone-400">-</span>}
                </td>
                <td className="max-w-md truncate px-4 py-3 text-stone-600">{row.comment || "-"}</td>
                <td className="px-4 py-3 text-right">
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
  integrationOptions,
  busy,
}) {
  if (!row) {
    return (
      <div className="flex h-[calc(100vh-3rem)] items-center justify-center text-stone-500">
        Select a document to review.
      </div>
    );
  }
  return (
    <div className="flex h-[calc(100vh-3rem)] min-h-[760px] flex-col overflow-hidden">
      <header className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Button type="button" variant="outline" onClick={backToList} className="h-10 gap-2">
            <ArrowLeft className="h-4 w-4" /> {client?.business_name || "Documents"}
          </Button>
          <div className="min-w-0">
            <h1 className="truncate font-display text-2xl font-bold text-stone-900">{row.description || "Submitted document"}</h1>
            <p className="truncate text-sm text-stone-500">{row.image_filename || "No file"} {row.comment ? `- ${row.comment}` : ""}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={prefillSelected} disabled={busy} className="h-10 gap-2">
            <Sparkles className="h-4 w-4" /> AI prefill
          </Button>
          <Button type="button" variant="outline" onClick={() => moveSelected("archived")} disabled={busy} className="h-10 gap-2">
            <Archive className="h-4 w-4" /> Archive
          </Button>
          <Button type="button" onClick={() => moveSelected("published")} disabled={busy} className="h-10 gap-2" style={{ background: "var(--brand)" }}>
            <CheckCircle2 className="h-4 w-4" /> Publish and Next
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(480px,0.92fr)_minmax(560px,1.08fr)]">
        <section className="min-h-0 overflow-hidden rounded-lg border border-stone-200 bg-white">
          <ReviewForm
            draft={draft}
            setDraft={setDraft}
            activeField={activeField}
            setActiveField={setActiveField}
            suggestLinesFromPattern={suggestLinesFromPattern}
            createSupplierFromDraft={createSupplierFromDraft}
            integrationOptions={integrationOptions}
            busy={busy}
          />
        </section>
        <section className="min-h-0 overflow-hidden rounded-lg border border-stone-200 bg-stone-100">
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between gap-3 border-b border-stone-200 bg-white px-3 py-3">
              <div className="min-w-0">
                <div className="truncate font-semibold text-stone-900">{row.image_filename || "Document preview"}</div>
                <div className="truncate text-xs text-stone-500">{row.comment || "No client comment"}</div>
              </div>
              <Badge variant="secondary" className="shrink-0 capitalize">{row.review_status || "inbox"}</Badge>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {row.image_filename ? (
                <div className="relative min-h-[720px] overflow-auto rounded-md border border-stone-200 bg-white">
                  {previewUrl ? (
                    isPdfFile(row.image_filename) ? (
                      <iframe title="Submitted PDF" src={previewUrl} className="h-[720px] w-full rounded-md bg-white" />
                    ) : (
                      <img src={previewUrl} alt="Submitted" className="block w-full rounded-md bg-white" />
                    )
                  ) : previewError ? (
                    <div className="flex h-full min-h-[720px] items-center justify-center p-6 text-center text-sm text-red-600">
                      {previewError}
                    </div>
                  ) : (
                    <div className="flex h-full min-h-[720px] items-center justify-center text-stone-500">
                      Loading preview...
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex h-full min-h-[720px] items-center justify-center rounded-md border border-dashed border-stone-300 bg-white text-stone-500">
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

function ReviewForm({ draft, setDraft, activeField, setActiveField, suggestLinesFromPattern, createSupplierFromDraft, integrationOptions, busy }) {
  const [patternLineIndex, setPatternLineIndex] = useState(0);
  const options = integrationOptions || {};
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
      <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
        <div>
          <div className="font-display text-lg font-bold text-stone-900">Coding fields</div>
          <div className="text-xs text-stone-500">Active field: {fieldLabel(activeField)}</div>
        </div>
        <Badge variant="secondary">{draft.currency || "GBP"}</Badge>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <DatalistField id="vendor_name" label="Vendor Name" value={draft.vendor_name} options={options.supplierOptions} onChange={(v) => set("vendor_name", v)} activeField={activeField} setActiveField={setActiveField} />
          <div>
            <Label className="text-xs font-semibold text-stone-700">Type</Label>
            <div className="mt-2 flex gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="radio" checked={draft.document_type === "bill"} onChange={() => set("document_type", "bill")} /> Bill</label>
              <label className="flex items-center gap-2"><input type="radio" checked={draft.document_type === "credit_note"} onChange={() => set("document_type", "credit_note")} /> Credit Note</label>
            </div>
          </div>
          <DatalistField id="vendor_account" label="Vendor A/C" value={draft.vendor_account} options={options.supplierAccountOptions} onChange={(v) => set("vendor_account", v)} activeField={activeField} setActiveField={setActiveField} />
          <TextField id="bill_number" label="Bill #" value={draft.bill_number} onChange={(v) => set("bill_number", v)} activeField={activeField} setActiveField={setActiveField} />
          <div className="md:col-span-2 -mt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={createSupplierFromDraft}
              disabled={busy || !String(draft.vendor_name || "").trim() || supplierExists(draft.vendor_name, options.supplierOptions)}
            >
              Create missing supplier
            </Button>
            {!options.supplierOptions?.length && (
              <span className="ml-3 text-xs text-stone-500">No QuickBooks suppliers synced for this client yet.</span>
            )}
          </div>
          <DatalistField id="category" label="Category" value={draft.category} options={options.categoryOptions} onChange={(v) => set("category", v)} activeField={activeField} setActiveField={setActiveField} />
          <TextField id="reference" label="Reference" value={draft.reference} onChange={(v) => set("reference", v)} activeField={activeField} setActiveField={setActiveField} />
          <TextField id="date" label="Date" value={draft.date} onChange={(v) => set("date", v)} activeField={activeField} setActiveField={setActiveField} />
          <TextField id="due_date" label="Due Date" value={draft.due_date} onChange={(v) => set("due_date", v)} activeField={activeField} setActiveField={setActiveField} />
        </div>

        <div className="mt-4">
          <TextField id="description" label="Description" value={draft.description} onChange={(v) => set("description", v)} activeField={activeField} setActiveField={setActiveField} />
        </div>

        <div className="mt-5 grid gap-4 border-t border-stone-200 pt-5 md:grid-cols-2">
          <div className="grid grid-cols-3 gap-3 md:grid-cols-1">
            <TextField id="net" label="Net" value={draft.net} onChange={(v) => set("net", v)} activeField={activeField} setActiveField={setActiveField} />
            <TextField id="vat" label="VAT" value={draft.vat} onChange={(v) => set("vat", v)} activeField={activeField} setActiveField={setActiveField} />
            <TextField id="total" label="Total" value={draft.total} onChange={(v) => set("total", v)} activeField={activeField} setActiveField={setActiveField} />
            <label className="col-span-3 flex items-center gap-3 text-sm font-medium text-stone-700 md:col-span-1">
              <input type="checkbox" checked={draft.mark_as_paid} onChange={(e) => set("mark_as_paid", e.target.checked)} />
              Mark as Paid
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3 md:grid-cols-1">
            <DatalistField id="vat_code" label="VAT Code" value={draft.vat_code} options={options.vatOptions} onChange={(v) => set("vat_code", v)} activeField={activeField} setActiveField={setActiveField} />
            <TextField id="currency" label="Currency" value={draft.currency} onChange={(v) => set("currency", v)} activeField={activeField} setActiveField={setActiveField} />
            <TextField id="payment_method" label="Payment Method" value={draft.payment_method} onChange={(v) => set("payment_method", v)} activeField={activeField} setActiveField={setActiveField} />
            {draft.mark_as_paid && (
              <DatalistField id="bank_account" label="Bank account" value={draft.bank_account} options={options.bankAccountOptions} onChange={(v) => set("bank_account", v)} activeField={activeField} setActiveField={setActiveField} />
            )}
          </div>
        </div>

        <div className="mt-5 border-t border-stone-200 pt-5">
          <div className="mb-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="font-display text-lg font-semibold text-stone-900">Line Items ({draft.line_items.length})</div>
            <div className="flex flex-wrap gap-2">
              <select className="h-9 rounded-md border border-stone-200 bg-white px-2 text-sm" value={draft.price_is} onChange={(e) => set("price_is", e.target.value)}>
                <option>Tax Exclusive</option>
                <option>Tax Inclusive</option>
              </select>
              <Button type="button" variant="outline" size="sm" onClick={clearLines} className="gap-2">
                <RotateCcw className="h-4 w-4" /> Clear
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => suggestLinesFromPattern(draft.line_items[patternLineIndex])}
                disabled={busy}
                className="gap-2"
              >
                <Wand2 className="h-4 w-4" /> Suggest from pattern
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
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-stone-200 text-left text-xs uppercase tracking-wider text-stone-500">
                <tr>
                  <th className="py-2 pr-2">Pattern</th>
                  <th className="py-2 pr-2">Description</th>
                  <th className="py-2 pr-2">Category</th>
                  <th className="py-2 pr-2">VAT Code</th>
                  <th className="py-2 pr-2">Units</th>
                  <th className="py-2 pr-2">Price</th>
                  <th className="py-2 pr-2">Net</th>
                  <th className="py-2 pr-2">VAT</th>
                  <th className="py-2">Total</th>
                  <th className="py-2 pl-2"></th>
                </tr>
              </thead>
              <tbody>
                {draft.line_items.map((line, index) => (
                  <tr key={index}>
                    <td className="py-2 pr-2 align-middle">
                      <input
                        type="radio"
                        name="line-pattern"
                        checked={patternLineIndex === index}
                        onChange={() => setPatternLineIndex(index)}
                        className="h-4 w-4"
                        title="Use this line as the pattern"
                      />
                    </td>
                    {["description", "category", "vat_code", "units", "price", "net", "vat", "total"].map((key) => (
                      <td key={key} className="py-2 pr-2">
                        <Input
                          value={line[key]}
                          onChange={(e) => setLine(index, key, e.target.value)}
                          onFocus={() => setActiveField(`line_items.${index}.${key}`)}
                          list={key === "category" ? "line-category-options" : key === "vat_code" ? "line-vat-options" : undefined}
                          className={`h-9 min-w-20 px-2 ${activeField === `line_items.${index}.${key}` ? "border-emerald-500 ring-2 ring-emerald-100" : ""}`}
                        />
                      </td>
                    ))}
                    <td className="py-2 pl-2 align-middle">
                      <Button type="button" variant="ghost" size="icon" onClick={() => removeLine(index)} className="h-8 w-8 text-stone-500 hover:text-red-600">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addLine} className="mt-3">
            Add line item
          </Button>
        </div>
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
        className={`mt-1 h-10 px-2 ${active ? "border-emerald-500 ring-2 ring-emerald-100" : ""}`}
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
        className={`mt-1 h-10 px-2 ${active ? "border-emerald-500 ring-2 ring-emerald-100" : ""}`}
      />
      <datalist id={listId}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </datalist>
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
        vat_code: "",
        units: "1",
        price: amount,
        net: amount,
        vat: "",
        total: amount,
      }];
  const base = {
    vendor_name: row?.client_business_name || row?.client?.business_name || "",
    vendor_account: "",
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
  };
  return reconcileDraftTotals({
    ...base,
    ...suggested,
    vendor_name: suggested.vendor_name || row?.client_business_name || row?.client?.business_name || "",
    description: suggested.description || description,
    date: suggested.date || row?.date || "",
    due_date: suggested.due_date || suggested.date || row?.date || "",
    net: suggested.net || amount,
    total: suggested.total || amount,
    currency: suggested.currency || "GBP",
    payment_method: displayPaymentMethod(suggested.payment_method) || paymentMethodLabel(row?.ai_payment_method),
    ocr_text_lines: Array.isArray(suggested.ocr_text_lines) ? suggested.ocr_text_lines : [],
    ocr_text_boxes: Array.isArray(suggested.ocr_text_boxes) ? suggested.ocr_text_boxes : [],
    line_items: lineItems.map((line) => ({
      description: line.description || "",
      category: line.category || "",
      vat_code: line.vat_code || "",
      units: line.units || "1",
      price: line.price || "",
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

function parseAmount(value) {
  const match = String(value || "").replace(/,/g, "").match(/-?\d+(?:\.\d{1,2})?/);
  return match ? Number(match[0]) : null;
}

function formatAmount(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "";
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
    "category",
    "date",
    "due_date",
    "bill_number",
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

function buildIntegrationOptions(records = {}) {
  const accounts = Array.isArray(records.account) ? records.account.filter((record) => record.active !== false) : [];
  const suppliers = Array.isArray(records.supplier) ? records.supplier.filter((record) => record.active !== false) : [];
  const taxCodes = Array.isArray(records.tax_code) ? records.tax_code.filter((record) => record.active !== false) : [];
  const supplierOptions = uniqueOptions(suppliers.map((record) => ({
    value: record.name || record.code || record.external_id || "",
    label: [record.code, record.name].filter(Boolean).join(" - ") || record.name || record.code || "",
  })));
  const supplierAccountOptions = uniqueOptions(suppliers.map((record) => ({
    value: record.code || record.name || record.external_id || "",
    label: [record.code, record.name].filter(Boolean).join(" - ") || record.name || record.code || "",
  })));
  const categoryOptions = uniqueOptions(accounts.map((record) => ({
    value: [record.code, record.name].filter(Boolean).join(" - ") || record.name || record.code || "",
    label: [record.code, record.name, record.description].filter(Boolean).join(" - "),
  })));
  const bankAccountOptions = uniqueOptions(accounts
    .filter(isBankAccountRecord)
    .map((record) => ({
      value: [record.code, record.name].filter(Boolean).join(" - ") || record.name || record.code || "",
      label: [record.code, record.name, record.description].filter(Boolean).join(" - "),
    })));
  const syncedVatOptions = uniqueOptions(taxCodes.map((record) => ({
    value: record.code || record.name || "",
    label: [record.code, record.name, record.description].filter(Boolean).join(" - "),
  })));
  return {
    supplierOptions,
    supplierAccountOptions,
    categoryOptions,
    bankAccountOptions,
    vatOptions: syncedVatOptions,
    vatSource: "integration",
  };
}

function uniqueOptions(options) {
  const seen = new Set();
  return options
    .map((option) => ({
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
  return !!needle && options.some((option) => String(option.value || "").trim().toLowerCase() === needle);
}

function isBankAccountRecord(record) {
  const raw = safeJson(record.raw_json);
  const text = [
    record.name,
    record.code,
    record.description,
    raw.AccountType,
    raw.AccountSubType,
    raw.Classification,
    raw.FullyQualifiedName,
  ].filter(Boolean).join(" ").toLowerCase();
  return ["bank", "cash", "credit card", "current account", "undeposited funds", "paypal"].some((needle) => text.includes(needle));
}

function safeJson(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
