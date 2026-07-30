import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Search, ChevronRight, Plus, ArrowUpDown, ReceiptText } from "lucide-react";
import { toast } from "sonner";

function parseListDate(value) {
  const [day, month, year] = String(value || "").split("/").map((part) => Number(part));
  if (!day || !month || !year) return Number.MAX_SAFE_INTEGER;
  return new Date(year, month - 1, day).getTime();
}

export default function ClientList() {
  const { type } = useParams();
  const nav = useNavigate();
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [sortDirection, setSortDirection] = useState("asc");

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
    const matches = !t ? items : items.filter((it) =>
      (it.description || "").toLowerCase().includes(t)
    );
    return [...matches].sort((a, b) => {
      const direction = sortDirection === "asc" ? 1 : -1;
      const dateDiff = (parseListDate(a.date) - parseListDate(b.date)) * direction;
      if (dateDiff) return dateDiff;
      return String(a.description || "").localeCompare(String(b.description || ""));
    });
  }, [items, q, sortDirection]);

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

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <Input placeholder="Search description..." value={q} onChange={(e) => setQ(e.target.value)} className="h-12 pl-10" data-testid="items-search" />
        </div>
        <button
          type="button"
          onClick={() => setSortDirection((current) => current === "asc" ? "desc" : "asc")}
          className="h-12 rounded-xl border border-stone-200 bg-white px-4 inline-flex items-center justify-center gap-2 text-sm font-semibold text-stone-700 hover:bg-stone-50"
          data-testid="sort-date-btn"
        >
          <ArrowUpDown className="h-4 w-4" />
          {sortDirection === "asc" ? "Oldest first" : "Newest first"}
        </button>
      </div>

      <button
        onClick={() => nav(`/portal/submit-additional/${type}`)}
        className="w-full rounded-2xl border-2 border-dashed border-[var(--brand)]/40 bg-[var(--brand)]/5 p-4 flex items-center justify-center gap-2 text-[var(--brand)] font-semibold card-hover"
        data-testid="add-additional-btn"
      >
        <Plus className="h-5 w-5" /> Add another invoice
      </button>

      {filtered.length === 0 ? (
        <div className="bg-white border border-dashed border-stone-300 rounded-2xl p-10 text-center" data-testid="no-items">
          <p className="font-display text-lg text-stone-700">{items.length === 0 ? "All clear!" : "No matches"}</p>
          <p className="text-stone-500 text-sm mt-1">{items.length === 0 ? "You've submitted everything in this list." : "Try a different search term."}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((it) => (
            <li key={it._id}>
              <button
                onClick={() => nav(`/portal/submit/${it._id}`)}
                className="group w-full rounded-xl border border-stone-200 bg-white p-4 text-left shadow-[0_3px_12px_rgba(28,25,23,0.06)] transition duration-150 hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-[0_10px_26px_rgba(6,78,59,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
                data-testid={`item-${it._id}`}
              >
                <div className="flex items-center gap-4">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                    <ReceiptText className="h-6 w-6" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge style={{ background: "var(--outstanding-bg)", color: "var(--outstanding)" }} className="hover:opacity-80">Outstanding</Badge>
                    </div>
                    <div className="truncate font-display font-bold text-stone-950">{it.description}</div>
                    <div className="text-xs text-stone-500 mt-1">
                      {it.date && <span>{it.date}</span>}
                      {it.amount && <span> - {it.amount}</span>}
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-stone-400 transition group-hover:translate-x-1 group-hover:text-emerald-700" />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
