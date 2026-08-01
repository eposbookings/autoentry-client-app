import React, { useEffect, useMemo, useRef, useState } from "react";

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
  clients: any[];
  initialClientId?: string;
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

type PayrollMembership = PayrollContextResponse & {
  firstPayDate: string;
};

export default function PayrollModule({ session, clients, initialClientId, onReturn, transport }: PayrollModuleProps) {
  const launches = useMemo(
    () => clients.map(client => assertPayrollLaunch({ session, client })),
    [clients, session],
  );
  const request = useMemo<PayrollTransport>(
    () => transport || ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, { credentials: "include", ...init })),
    [transport],
  );
  const [memberships, setMemberships] = useState<PayrollMembership[]>([]);
  const [activeEmployerId, setActiveEmployerId] = useState(0);
  const [error, setError] = useState("");
  const activeMembership = memberships.find(item => item.employerId === activeEmployerId) || memberships[0];
  const activeClientId = useRef("");
  activeClientId.current = activeMembership?.clientId || initialClientId || launches[0]?.clientId || "";

  const moduleTransport = useMemo<PayrollTransport>(() => (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("X-Payroll-Client-ID", activeClientId.current);
    return request(input, { credentials: "include", ...init, headers });
  }, [request]);

  useEffect(() => configurePayrollTransport(moduleTransport), [moduleTransport]);

  useEffect(() => {
    let active = true;
    setMemberships([]);
    setActiveEmployerId(0);
    setError("");

    Promise.all(launches.map(async launch => {
      const response = await request(`/api/payroll/context/${encodeURIComponent(String(launch.clientId))}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body) throw new Error(body?.detail || body?.error || "Payroll could not be opened.");
      return { ...body, clientId: String(launch.clientId), firstPayDate: body.firstPayDate || "" } as PayrollMembership;
    }))
      .then(available => {
        if (!active) return;
        setMemberships(available);
        const requested = available.find(item => String(item.clientId) === String(initialClientId || ""));
        const employerFromUrl = new URLSearchParams(window.location.search).get("employerId");
        const linked = available.find(item => String(item.employerId) === employerFromUrl);
        setActiveEmployerId((requested || linked || available[0]).employerId);
      })
      .catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : "Payroll could not be opened.");
      });

    return () => { active = false; };
  }, [initialClientId, launches, request]);

  function switchEmployer(employerId: number) {
    const membership = memberships.find(item => item.employerId === employerId);
    if (!membership) return;
    activeClientId.current = membership.clientId;
    setActiveEmployerId(employerId);
    const url = new URL(window.location.href);
    url.searchParams.set("employerId", String(employerId));
    window.history.replaceState({}, "", url);
  }

  if (error) return <main className="payroll-module portal-page"><section className="portal-login"><div className="brandmark">P</div><h1>Payroll unavailable</h1><p>{error}</p><button className="primary" onClick={onReturn}>Return to EPOS Accountancy</button></section></main>;
  if (!activeMembership) return <main className="payroll-module portal-page"><section className="portal-login"><div className="brandmark">P</div><h1>Loading employer payrolls…</h1></section></main>;

  const frequency = payrollFrequencyRule(activeMembership.payFrequency).frequency;

  return <div className="payroll-module">
    <EmployerContext.Provider value={activeMembership.employerId}>
      <TaxYearContext.Provider value={activeMembership.taxYear}>
        <PayFrequencyContext.Provider value={frequency}>
          <FirstPayDateContext.Provider value={activeMembership.firstPayDate}>
            <PayrollApp
              key={`${activeMembership.employerId}:${activeMembership.taxYear}:${frequency}:${activeMembership.firstPayDate}`}
              admin={session.user}
              memberships={memberships}
              activeEmployerId={activeMembership.employerId}
              setActiveEmployerId={switchEmployer}
              signOut={onReturn}
            />
          </FirstPayDateContext.Provider>
        </PayFrequencyContext.Provider>
      </TaxYearContext.Provider>
    </EmployerContext.Provider>
  </div>;
}
