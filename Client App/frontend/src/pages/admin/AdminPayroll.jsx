import React, { Suspense, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LoaderCircle } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { api, authenticatedFetch, formatApiError } from "@/lib/api";

const PayrollModule = React.lazy(() => import("@/modules/payroll/PayrollModule"));

export default function AdminPayroll() {
  const { clientId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api.get("/payroll/clients")
      .then(({ data }) => {
        if (active) setClients(data.clients || []);
      })
      .catch(reason => {
        if (active) setError(formatApiError(reason) || "Payroll could not be opened.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  if (loading) return <main className="payroll-module portal-page"><section className="portal-login"><div className="brandmark">P</div><h1><LoaderCircle className="inline h-5 w-5 animate-spin" /> Loading payroll workspace…</h1></section></main>;
  if (error) return <main className="payroll-module portal-page"><section className="portal-login"><div className="brandmark">P</div><h1>Payroll unavailable</h1><p>{error}</p><button className="primary" onClick={() => navigate("/admin")}>Return to EPOS Accountancy</button></section></main>;
  if (!clients.length) return <main className="payroll-module portal-page"><section className="portal-login"><div className="brandmark">P</div><h1>No payroll employers</h1><p>Enable Payroll in a client’s Services and pricing settings to add that employer here.</p><button className="primary" onClick={() => navigate("/admin")}>Return to EPOS Accountancy</button></section></main>;

  return <Suspense fallback={<main className="payroll-module portal-page"><section className="portal-login"><div className="brandmark">P</div><h1>Loading payroll workspace…</h1></section></main>}>
    <PayrollModule
      session={{ user, practiceId: user?.practice_id, role: user?.role }}
      clients={clients}
      initialClientId={clientId}
      transport={authenticatedFetch}
      onReturn={() => navigate("/admin")}
    />
  </Suspense>;
}
