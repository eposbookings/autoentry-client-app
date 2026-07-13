import React, { useCallback, useEffect, useState } from "react";
import { api, formatApiError, API } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search } from "lucide-react";
import { toast } from "sonner";

export default function AdminSubmissions() {
  const [rows, setRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [filters, setFilters] = useState({ client_id: "", type: "", q: "" });
  const [preview, setPreview] = useState(null);
  const previewUrl = preview ? `${API}/admin/uploads/${preview}` : "";

  const load = useCallback(async () => {
    try {
      const params = {};
      Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
      const { data } = await api.get("/admin/submissions", { params });
      setRows(data);
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get("/admin/clients")
      .then((r) => setClients(r.data))
      .catch((e) => console.error("Failed to load clients filter:", formatApiError(e)));
  }, []);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-stone-900">Submissions</h1>
        <p className="mt-1 text-stone-600">Every document your clients have submitted, with comments and attachments.</p>
      </header>

      <div className="grid sm:grid-cols-3 gap-3">
        <select value={filters.client_id} onChange={(e) => setFilters({ ...filters, client_id: e.target.value })} className="h-11 rounded-md border border-stone-200 bg-white px-3 text-sm" data-testid="filter-client">
          <option value="">All clients</option>
          {clients.map((c) => <option key={c._id} value={c._id}>{c.business_name}</option>)}
        </select>
        <select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })} className="h-11 rounded-md border border-stone-200 bg-white px-3 text-sm" data-testid="filter-type">
          <option value="">All types</option>
          <option value="purchase">Purchase</option>
          <option value="sales">Sales</option>
        </select>
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <Input placeholder="Search description or comment" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} className="h-11 pl-10" data-testid="filter-q" />
        </div>
      </div>

      <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-stone-600 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Submitted</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Comment</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-stone-500">No submissions yet.</td></tr>
              )}
              {rows.map((s) => (
                <tr key={s.id} className="border-t border-stone-100 hover:bg-stone-50/50" data-testid={`sub-row-${s.id}`}>
                  <td className="px-4 py-3 whitespace-nowrap text-stone-700">{s.submitted_at ? new Date(s.submitted_at).toLocaleString() : "—"}</td>
                  <td className="px-4 py-3 text-stone-800">{s.client?.business_name || s.client_business_name || "—"}</td>
                  <td className="px-4 py-3 capitalize text-stone-700">
                    <Badge variant="secondary" className="capitalize">{s.type}</Badge>
                  </td>
                  <td className="px-4 py-3 font-medium text-stone-900">
                    <div className="flex items-center gap-2">
                      <span>{s.description || "—"}</span>
                      {s.is_additional && (
                        <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100" data-testid={`additional-badge-${s.id}`}>Additional</Badge>
                      )}
                      {s.ai_client_approved && (
                        <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100" data-testid={`ai-client-approved-${s.id}`}>Client approved</Badge>
                      )}
                      {s.ai_review_status === "needs_review" && !s.ai_client_approved && (
                        <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100" data-testid={`ai-needs-review-${s.id}`}>Needs review</Badge>
                      )}
                      {s.ai_review_status === "rejected" && !s.ai_client_approved && (
                        <Badge className="bg-red-100 text-red-800 hover:bg-red-100" data-testid={`ai-rejected-${s.id}`}>Rejected</Badge>
                      )}
                      {s.ai_review_status === "approved" && (
                        <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100" data-testid={`ai-approved-${s.id}`}>AI checked</Badge>
                      )}
                    </div>
                    {s.ai_review_message && (
                      <div className="mt-1 text-xs text-stone-500 max-w-md">{s.ai_review_message}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-stone-700">{s.date || "—"}</td>
                  <td className="px-4 py-3 text-stone-700">{s.amount || "—"}</td>
                  <td className="px-4 py-3 text-stone-700 max-w-xs truncate">{s.comment || "—"}</td>
                  <td className="px-4 py-3 text-right">
                    {s.image_filename && (
                      <Button size="sm" variant="outline" onClick={() => setPreview(s.image_filename)} data-testid={`preview-${s.id}`}>Preview</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Submitted document</DialogTitle></DialogHeader>
          {preview && (
            isPdfFile(preview) ? (
              <iframe src={previewUrl} title="Submitted PDF" className="rounded-lg w-full h-[75vh] border border-stone-200" />
            ) : (
              <img src={previewUrl} alt="Submitted" className="rounded-lg w-full" />
            )
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function isPdfFile(filename) {
  return filename?.toLowerCase().endsWith(".pdf");
}
