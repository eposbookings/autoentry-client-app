import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Search, ChevronRight } from "lucide-react";
import { toast } from "sonner";

export default function ClientList() {
  const { type } = useParams();
  const nav = useNavigate();
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    api.get("/client/items", { params: { type } })
      .then((r) => setItems(r.data))
      .catch((e) => {
        const msg = formatApiError(e);
        console.error("Items fetch failed:", msg);
        toast.error(msg);
      });
  }, [type]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return items;
    return items.filter((it) =>
      (it.description || "").toLowerCase().includes(t)
    );
  }, [items, q]);

  const title = type === "purchase" ? "Purchase Invoices" : "Sales Invoices";

  return (
    <div className="space-y-6">
      <button onClick={() => nav("/portal")} className="text-sm text-stone-500 hover:text-stone-700 inline-flex items-center gap-1" data-testid="back-dashboard">
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </button>

      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-stone-900">{title}</h1>
        <p className="text-stone-600 mt-1">{items.length} outstanding {items.length === 1 ? "item" : "items"}</p>
      </div>

      <div className="relative">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
        <Input placeholder="Search description…" value={q} onChange={(e) => setQ(e.target.value)} className="h-12 pl-10" data-testid="items-search" />
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white border border-dashed border-stone-300 rounded-2xl p-10 text-center" data-testid="no-items">
          <p className="font-display text-lg text-stone-700">{items.length === 0 ? "All clear!" : "No matches"}</p>
          <p className="text-stone-500 text-sm mt-1">{items.length === 0 ? "You've submitted everything in this list. 🎉" : "Try a different search term."}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((it) => (
            <li key={it._id}>
              <button
                onClick={() => nav(`/portal/submit/${it._id}`)}
                className="w-full text-left rounded-2xl border border-stone-200 bg-white p-5 card-hover"
                data-testid={`item-${it._id}`}
              >
                <div className="flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge style={{ background: "var(--outstanding-bg)", color: "var(--outstanding)" }} className="hover:opacity-80">Outstanding</Badge>
                    </div>
                    <div className="font-display font-semibold text-stone-900 truncate">{it.description}</div>
                    <div className="text-xs text-stone-500 mt-1">
                      {it.date && <span>{it.date}</span>}
                      {it.amount && <span> · {it.amount}</span>}
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-stone-400" />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
