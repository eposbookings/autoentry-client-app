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
      className="text-left p-6 sm:p-7 rounded-2xl border border-stone-200 bg-white card-hover w-full"
      data-testid={testid}
    >
      <div className="flex items-start justify-between">
        <div className="h-11 w-11 rounded-xl flex items-center justify-center"
          style={{ background: has ? "var(--outstanding-bg)" : "#f5f5f4", color: has ? "var(--outstanding)" : "#a8a29e" }}>
          {icon}
        </div>
        <ArrowRight className="h-5 w-5 text-stone-400" />
      </div>
      <div className="mt-6">
        <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold">{desc}</div>
        <div className="font-display text-xl font-semibold text-stone-900 mt-0.5">{title}</div>
      </div>
      <div className="mt-4 flex items-baseline gap-2">
        <span className="count-xl" style={{ color: has ? "var(--outstanding)" : "#a8a29e" }}>{count}</span>
        <span className="text-sm text-stone-500">outstanding</span>
      </div>
    </button>
  );
}
