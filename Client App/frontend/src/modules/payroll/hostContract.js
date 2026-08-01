export const PAYROLL_SERVICE_KEY = "payroll";

function parseServices(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function payrollServiceEnabled(client) {
  const services = parseServices(client?.service_settings ?? client?.serviceSettings ?? client?.services);
  const payroll = services[PAYROLL_SERVICE_KEY];
  return payroll === true || payroll?.enabled === true;
}

export function assertPayrollLaunch({ session, client }) {
  if (!session?.user) throw new Error("EPOS authentication is required.");
  if (!client?.id) throw new Error("An EPOS client is required.");
  if (!payrollServiceEnabled(client)) throw new Error("Payroll is not enabled for this client.");

  return Object.freeze({
    practiceId: session.practiceId ?? session.user?.practice_id,
    clientId: client.id,
    user: session.user,
    role: session.role,
  });
}

export function payrollApiPath(path = "") {
  const suffix = String(path).replace(/^\/+/, "");
  return `/api/payroll${suffix ? `/${suffix}` : ""}`;
}
