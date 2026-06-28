import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Search, CheckCircle2, ChevronRight } from "lucide-react";
import { toast } from "sonner";

export default function ClientList() {
  const { type } = useParams();
  const nav = useNavigate();
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    api.get("/client/items", { params: { type } })
      .then((r) => setItems(r.data))
      .catch((e) => toast.error(formatApiError(e)));
  }, [type]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return items;
    return items.filter((it) =>
      (it.invoice_number || "").toLowerCase().includes(t) ||
      (it.party || "").toLowerCase().includes(t) ||
      (it.reference || "").toLowerCase().includes(t)
    );
  }, [items, q]);

  const title = type === "purchase" ? "Purchase Invoices" : "Sales Invoices";
  const outstanding = items.filter((i) => i.status === "outstanding").length;

  return (
    <div className="space-y-6">
      <button onClick={() => nav("/portal")} className="text-sm text-stone-500 hover:text-stone-700 inline-flex items-center gap-1" data-testid="back-dashboard">
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </button>

      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-stone-900">{title}</h1>
        <p className="text-stone-600 mt-1">{outstanding} outstanding · {items.length - outstanding} submitted</p>
      </div>

      <div className="relative">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
        <Input placeholder="Search invoice number, party, reference…" value={q} onChange={(e) => setQ(e.target.value)} className="h-12 pl-10" data-testid="items-search" />
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white border border-dashed border-stone-300 rounded-2xl p-10 text-center" data-testid="no-items">
          <p className="font-display text-lg text-stone-700">Nothing here</p>
          <p className="text-stone-500 text-sm mt-1">{items.length === 0 ? "Your accountant hasn't uploaded a list yet." : "No items match your search."}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((it) => {
            const submitted = it.status === "submitted";
            return (
              <li key={it._id}>
                <button
                  onClick={() => submitted ? null : nav(`/portal/submit/${it._id}`)}
                  disabled={submitted}
                  className={`w-full text-left rounded-2xl border bg-white p-5 transition-all ${submitted ? "border-emerald-200 opacity-90 cursor-default" : "border-stone-200 card-hover"}`}
                  data-testid={`item-${it._id}`}
                >
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="font-display font-semibold text-stone-900 truncate">{it.invoice_number}</div>
                        {submitted ? (
                          <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 gap-1"><CheckCircle2 className="h-3 w-3" /> Submitted</Badge>
                        ) : (
                          <Badge style={{ background: "var(--outstanding-bg)", color: "var(--outstanding)" }} className="hover:opacity-80">Outstanding</Badge>
                        )}
                      </div>
                      <div className="text-sm text-stone-700 truncate">{it.party || "—"}</div>
                      <div className="text-xs text-stone-500 mt-1">
                        {it.invoice_date && <span>{it.invoice_date}</span>}
                        {it.amount && <span> · {it.amount}</span>}
                        {it.reference && <span> · {it.reference}</span>}
                      </div>
                    </div>
                    {!submitted && <ChevronRight className="h-5 w-5 text-stone-400" />}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
