import { api } from "@/lib/api";

const workspaceByClient = new Map();
const requestByClient = new Map();

export function cachedAccountingWorkspace(clientId) {
  return clientId ? workspaceByClient.get(String(clientId)) || null : null;
}

export async function fetchAccountingWorkspace(clientId, { force = false } = {}) {
  const key = String(clientId || "");
  if (!key) return null;
  if (!force && workspaceByClient.has(key)) return workspaceByClient.get(key);
  if (requestByClient.has(key)) return requestByClient.get(key);

  const request = api.get(`/admin/accounting/clients/${key}`)
    .then(({ data }) => {
      workspaceByClient.set(key, data);
      return data;
    })
    .finally(() => requestByClient.delete(key));
  requestByClient.set(key, request);
  return request;
}

export function updateCachedAccountingClient(clientId, client) {
  const key = String(clientId || "");
  const workspace = workspaceByClient.get(key);
  if (!workspace || !client) return;
  workspaceByClient.set(key, {
    ...workspace,
    client: { ...(workspace.client || {}), ...client },
  });
}

export function clearCachedAccountingWorkspace(clientId) {
  workspaceByClient.delete(String(clientId || ""));
}
