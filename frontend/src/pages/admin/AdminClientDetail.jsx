import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Upload, Trash2, KeyRound, Save } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";

export default function AdminClientDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [client, setClient] = useState(null);
  const [items, setItems] = useState({ purchase: [], sales: [] });
  const [tab, setTab] = useState("purchase");
  const [pwd, setPwd] = useState("");

  const load = useCallback(async () => {
    try {
      const [c, p, s] = await Promise.all([
        api.get(`/admin/clients/${id}`),
        api.get(`/admin/clients/${id}/items`, { params: { type: "purchase" } }),
        api.get(`/admin/clients/${id}/items`, { params: { type: "sales" } }),
      ]);
      setClient(c.data);
      setItems({ purchase: p.data, sales: s.data });
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function saveClient() {
    try {
      await api.put(`/admin/clients/${id}`, {
        first_name: client.first_name, last_name: client.last_name,
        business_name: client.business_name, email: client.email,
        autoentry_email: client.autoentry_email, status: client.status,
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

  async function onUpload(type, file) {
    if (!file) return;
    const fd = new FormData();
    fd.append("type", type);
    fd.append("file", file);
    try {
      const { data } = await api.post(`/admin/clients/${id}/upload-csv`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(`Imported ${data.rows_imported} rows${data.errors.length ? `, ${data.errors.length} errors` : ""}`);
      if (data.errors.length) console.warn("CSV errors:", data.errors);
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }

  async function resetItem(itemId) {
    try {
      await api.post(`/admin/items/${itemId}/reset`);
      toast.success("Item reset to outstanding");
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }

  if (!client) return <div className="text-stone-500">Loading…</div>;

  return (
    <div className="space-y-8">
      <button onClick={() => nav("/admin")} className="text-sm text-stone-500 hover:text-stone-700 inline-flex items-center gap-1" data-testid="back-to-clients">
        <ArrowLeft className="h-4 w-4" /> Back to clients
      </button>

      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-stone-900">{client.business_name}</h1>
          <p className="text-stone-600">{client.first_name} {client.last_name} · {client.email}</p>
        </div>
        <div className="flex gap-2">
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

      {/* Edit details */}
      <section className="bg-white border border-stone-200 rounded-2xl p-6">
        <h2 className="font-display text-xl font-semibold mb-4">Account details</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="First name" value={client.first_name} onChange={(v)=>setClient({...client, first_name: v})} testid="edit-first-name" />
          <Field label="Last name" value={client.last_name} onChange={(v)=>setClient({...client, last_name: v})} testid="edit-last-name" />
          <Field label="Business name" value={client.business_name} onChange={(v)=>setClient({...client, business_name: v})} testid="edit-business-name" />
          <Field label="Login email" type="email" value={client.email} onChange={(v)=>setClient({...client, email: v})} testid="edit-email" />
          <Field label="AutoEntry email" type="email" value={client.autoentry_email} onChange={(v)=>setClient({...client, autoentry_email: v})} testid="edit-autoentry-email" />
          <div>
            <Label className="text-sm font-semibold text-stone-700">Status</Label>
            <select
              value={client.status}
              onChange={(e) => setClient({ ...client, status: e.target.value })}
              className="mt-1.5 h-11 w-full rounded-md border border-stone-200 bg-white px-3 text-sm"
              data-testid="edit-status"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <Button onClick={saveClient} className="gap-2" style={{ background: "var(--brand)" }} data-testid="save-client-btn">
            <Save className="h-4 w-4" /> Save changes
          </Button>
        </div>
      </section>

      {/* Password reset */}
      <section className="bg-white border border-stone-200 rounded-2xl p-6">
        <h2 className="font-display text-xl font-semibold mb-4 flex items-center gap-2"><KeyRound className="h-4 w-4" /> Reset client password</h2>
        <div className="flex flex-col sm:flex-row gap-3 max-w-lg">
          <Input type="text" placeholder="New password (min 6 chars)" value={pwd} onChange={(e)=>setPwd(e.target.value)} className="h-11" data-testid="new-password-input" />
          <Button onClick={resetPassword} variant="outline" data-testid="reset-password-btn">Reset</Button>
        </div>
      </section>

      {/* Outstanding lists with CSV upload */}
      <section className="bg-white border border-stone-200 rounded-2xl p-6">
        <Tabs value={tab} onValueChange={setTab}>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
            <h2 className="font-display text-xl font-semibold">Outstanding items</h2>
            <TabsList>
              <TabsTrigger value="purchase" data-testid="tab-purchase">Purchase ({items.purchase.length})</TabsTrigger>
              <TabsTrigger value="sales" data-testid="tab-sales">Sales ({items.sales.length})</TabsTrigger>
            </TabsList>
          </div>

          {["purchase", "sales"].map((t) => (
            <TabsContent value={t} key={t} className="space-y-4">
              <CsvUploader type={t} onUpload={onUpload} />
              {items[t].length === 0 ? (
                <p className="text-stone-500 text-sm py-6 text-center">No outstanding items. Upload a CSV to get started.</p>
              ) : (
                <div className="overflow-x-auto -mx-2">
                  <table className="w-full text-sm">
                    <thead className="bg-stone-50 text-left text-stone-600 text-xs uppercase tracking-wider">
                      <tr>
                        <th className="px-3 py-3">Description</th>
                        <th className="px-3 py-3">Date</th>
                        <th className="px-3 py-3">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items[t].map((it) => (
                        <tr key={it._id} className="border-t border-stone-100" data-testid={`admin-item-${it._id}`}>
                          <td className="px-3 py-3 font-medium text-stone-900">{it.description}</td>
                          <td className="px-3 py-3 text-stone-600">{it.date}</td>
                          <td className="px-3 py-3 text-stone-700">{it.amount}</td>
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
    </div>
  );
}

function Field({ label, value, onChange, type = "text", testid }) {
  return (
    <div>
      <Label className="text-sm font-semibold text-stone-700">{label}</Label>
      <Input type={type} value={value || ""} onChange={(e) => onChange(e.target.value)} className="mt-1.5 h-11" data-testid={testid} />
    </div>
  );
}

function CsvUploader({ type, onUpload }) {
  const inputId = `csv-${type}`;
  return (
    <div className="border border-dashed border-stone-300 rounded-xl p-5 bg-stone-50/50 flex flex-col sm:flex-row items-start sm:items-center gap-3">
      <div className="flex-1">
        <p className="font-semibold text-stone-800 text-sm">Upload {type === "purchase" ? "Purchase Invoices" : "Sales Invoices"} CSV</p>
        <p className="text-xs text-stone-500 mt-1">Columns: <strong>Description, Date, Amount</strong>. Uploading replaces the existing list.</p>
      </div>
      <label htmlFor={inputId} className="cursor-pointer">
        <span className="inline-flex items-center gap-2 px-4 h-10 rounded-lg text-sm font-medium text-white" style={{ background: "var(--brand)" }} data-testid={`upload-csv-${type}-btn`}>
          <Upload className="h-4 w-4" /> Choose CSV
        </span>
        <input id={inputId} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onUpload(type, e.target.files?.[0])} data-testid={`upload-csv-${type}-input`} />
      </label>
    </div>
  );
}
