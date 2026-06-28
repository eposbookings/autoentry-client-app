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
  const [filters, setFilters] = useState({ client_id: "", type: "", status: "", q: "" });
  const [preview, setPreview] = useState(null);

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

  async function resetItem(itemId) {
    try {
      await api.post(`/admin/items/${itemId}/reset`);
      toast.success("Item reset");
      load();
    } catch (e) { toast.error(formatApiError(e)); }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-stone-900">Submissions</h1>
        <p className="mt-1 text-stone-600">Review every client submission and reset any item back to outstanding if needed.</p>
      </header>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <select value={filters.client_id} onChange={(e) => setFilters({ ...filters, client_id: e.target.value })} className="h-11 rounded-md border border-stone-200 bg-white px-3 text-sm" data-testid="filter-client">
          <option value="">All clients</option>
          {clients.map((c) => <option key={c._id} value={c._id}>{c.business_name}</option>)}
        </select>
        <select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })} className="h-11 rounded-md border border-stone-200 bg-white px-3 text-sm" data-testid="filter-type">
          <option value="">All types</option>
          <option value="purchase">Purchase</option>
          <option value="sales">Sales</option>
        </select>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="h-11 rounded-md border border-stone-200 bg-white px-3 text-sm" data-testid="filter-status">
          <option value="">All statuses</option>
          <option value="submitted">Submitted</option>
          <option value="outstanding">Outstanding</option>
        </select>
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <Input placeholder="Search invoice or party" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} className="h-11 pl-10" data-testid="filter-q" />
        </div>
      </div>

      <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-stone-600 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Invoice #</th>
                <th className="px-4 py-3">Party</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Comment</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-stone-500">No items match these filters.</td></tr>
              )}
              {rows.map((it) => (
                <tr key={it._id} className="border-t border-stone-100 hover:bg-stone-50/50" data-testid={`sub-row-${it._id}`}>
                  <td className="px-4 py-3 whitespace-nowrap text-stone-700">{it.submitted_at ? new Date(it.submitted_at).toLocaleString() : "—"}</td>
                  <td className="px-4 py-3 text-stone-800">{it.client?.business_name || "—"}</td>
                  <td className="px-4 py-3 capitalize text-stone-700">{it.type}</td>
                  <td className="px-4 py-3 font-medium text-stone-900">{it.invoice_number}</td>
                  <td className="px-4 py-3 text-stone-700">{it.party}</td>
                  <td className="px-4 py-3">
                    {it.status === "submitted"
                      ? <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Submitted</Badge>
                      : <Badge style={{ background: "var(--outstanding-bg)", color: "var(--outstanding)" }} className="hover:opacity-80">Outstanding</Badge>}
                  </td>
                  <td className="px-4 py-3 text-stone-700 max-w-xs truncate">{it.submission?.comment || "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex gap-2 justify-end">
                      {it.submission?.image_filename && (
                        <Button size="sm" variant="outline" onClick={() => setPreview(it.submission.image_filename)} data-testid={`preview-${it._id}`}>Preview</Button>
                      )}
                      {it.status === "submitted" && (
                        <Button size="sm" variant="ghost" onClick={() => resetItem(it._id)} data-testid={`reset-sub-${it._id}`}>Reset</Button>
                      )}
                    </div>
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
            <img src={`${API}/admin/uploads/${preview}`} alt="Submitted" className="rounded-lg w-full" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
