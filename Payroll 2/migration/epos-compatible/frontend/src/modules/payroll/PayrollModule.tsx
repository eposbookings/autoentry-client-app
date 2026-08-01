import React, { useEffect, useMemo, useState } from "react";

import {
  EmployerContext,
  FirstPayDateContext,
  PayFrequencyContext,
  PayrollApp,
  TaxYearContext,
  configurePayrollTransport,
  type PayrollTransport,
} from "./PayrollWorkspace";
import { payrollFrequencyRule } from "./lib/pay-frequency";
import { assertPayrollLaunch } from "./hostContract";
import "./payroll.css";

export type PayrollModuleProps = {
  session: { user: any; practiceId?: string; role?: string };
  client: any;
  onReturn: () => void;
  transport?: PayrollTransport;
};

type PayrollContextResponse = {
  employerId: number;
  clientId: string;
  employerName: string;
  taxYear: string;
  payFrequency: string;
  firstPayDate?: string | null;
  role: string;
  canViewConfidential: boolean;
};

export default function PayrollModule({ session, client, onReturn, transport }: PayrollModuleProps) {
  const launch = useMemo(() => assertPayrollLaunch({ session, client }), [session, client]);
  const [context, setContext] = useState<PayrollContextResponse | null>(null);
  const [error, setError] = useState("");
  const moduleTransport = useMemo<PayrollTransport>(() => {
    const request = transport || ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, { credentials: "include", ...init }));
    return (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("X-Payroll-Client-ID", String(launch.clientId));
      return request(input, { credentials: "include", ...init, headers });
    };
  }, [launch.clientId, transport]);

  useEffect(() => configurePayrollTransport(moduleTransport), [moduleTransport]);

  useEffect(() => {
    let active = true;
    setContext(null);
    setError("");
    moduleTransport(`/api/payroll/context/${encodeURIComponent(String(launch.clientId))}`, { cache: "no-store" })
      .then(async response => ({ response, body: await response.json().catch(() => null) }))
      .then(({ response, body }) => {
        if (!response.ok || !body) throw new Error(body?.detail || body?.error || "Payroll could not be opened.");
        if (active) setContext(body);
      })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Payroll could not be opened."); });
    return () => { active = false; };
  }, [launch.clientId, moduleTransport]);

  if (error) return <main className="payroll-module portal-page"><section className="portal-login"><div className="brandmark">P</div><h1>Payroll unavailable</h1><p>{error}</p><button className="primary" onClick={onReturn}>Return to EPOS Accountancy</button></section></main>;
  if (!context) return <main className="payroll-module portal-page"><section className="portal-login"><div className="brandmark">P</div><h1>Loading payroll workspace…</h1></section></main>;

  const membership = {
    employerId: context.employerId,
    employerName: context.employerName,
    taxYear: context.taxYear,
    payFrequency: context.payFrequency,
    firstPayDate: context.firstPayDate || "",
    role: context.role,
    canViewConfidential: context.canViewConfidential,
  };
  const frequency = payrollFrequencyRule(membership.payFrequency).frequency;

  return <div className="payroll-module">
    <EmployerContext.Provider value={membership.employerId}>
      <TaxYearContext.Provider value={membership.taxYear}>
        <PayFrequencyContext.Provider value={frequency}>
          <FirstPayDateContext.Provider value={membership.firstPayDate}>
            <PayrollApp
              key={`${membership.employerId}:${membership.taxYear}:${frequency}:${membership.firstPayDate}`}
              admin={session.user}
              memberships={[membership]}
              activeEmployerId={membership.employerId}
              setActiveEmployerId={() => undefined}
              signOut={onReturn}
            />
          </FirstPayDateContext.Provider>
        </PayFrequencyContext.Provider>
      </TaxYearContext.Provider>
    </EmployerContext.Provider>
  </div>;
}
