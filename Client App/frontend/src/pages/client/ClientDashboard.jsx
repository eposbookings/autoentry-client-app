import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api, formatApiError } from "@/lib/api";
import { ShoppingCart, Receipt, ArrowRight } from "lucide-react";
import { toast } from "sonner";

export default function ClientDashboard() {
  const { user } = useAuth();
  const [counts, setCounts] = useState({ purchase_outstanding: 0, sales_outstanding: 0 });
  const nav = useNavigate();

  useEffect(() => {
    api.get("/client/counts")
      .then((r) => setCounts(r.data))
      .catch((e) => {
        const msg = formatApiError(e);
        console.error("Counts fetch failed:", msg);
        toast.error(msg);
      });
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-stone-900">
          Hi {user?.first_name} 👋
        </h1>
        <p className="mt-1 text-stone-600">Tap a category to see and submit your outstanding documents.</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-5">
        <BigButton
          title="Purchase Invoices"
          desc="Receipts & supplier bills"
          count={counts.purchase_outstanding}
          icon={<ShoppingCart className="h-6 w-6" />}
          onClick={() => nav("/portal/list/purchase")}
          testid="btn-purchase"
        />
        <BigButton
          title="Sales Invoices"
          desc="Customer invoices"
          count={counts.sales_outstanding}
          icon={<Receipt className="h-6 w-6" />}
          onClick={() => nav("/portal/list/sales")}
          testid="btn-sales"
        />
      </div>

      <div className="rounded-2xl p-5 border border-stone-200 bg-white">
        <p className="text-sm text-stone-600 leading-relaxed">
          <span className="font-semibold text-stone-800">How it works:</span> tap an outstanding invoice, then either take/upload a photo of the document, or tell us why no document is needed. We forward it straight to your accountant.
        </p>
      </div>
    </div>
  );
}

function BigButton({ title, desc, count, icon, onClick, testid }) {
  const has = count > 0;
  return (
    <button
      onClick={onClick}
      className="group flex min-h-[220px] w-full flex-col rounded-xl border border-stone-200 bg-white p-5 text-left shadow-[0_3px_12px_rgba(28,25,23,0.07)] transition duration-150 hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-[0_10px_26px_rgba(6,78,59,0.13)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 sm:p-6"
      data-testid={testid}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
          {icon}
        </div>
        <ArrowRight className="mt-3 h-5 w-5 text-stone-400 transition group-hover:translate-x-1 group-hover:text-emerald-700" />
      </div>
      <div className="mt-5 flex-1">
        <div className="font-display text-xl font-bold text-stone-950">{title}</div>
        <div className="mt-1 text-xs font-bold uppercase tracking-wider text-emerald-700">{desc}</div>
      </div>
      <div className="mt-4 flex items-center gap-3 border-t border-stone-200 pt-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-50 text-sm font-bold text-amber-800">{count}</span>
        <span>
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-stone-500">Outstanding items</span>
          <span className={`font-display text-base font-bold ${has ? "text-amber-900" : "text-stone-400"}`}>{count} awaiting documents</span>
        </span>
      </div>
    </button>
  );
}
