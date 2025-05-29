import { adminLoading } from '$lib/stores/admin-loading';

interface FetchOptions {
  operationId?: string;
  description?: string;
  showLoading?: boolean;
}

export async function fetchAdminData(
  _fetch: typeof fetch,
  part: string,
  token?: string | Promise<string | undefined>,
  options: FetchOptions = {}
) {
  const { 
    operationId = `fetch-${part}-${Date.now()}`,
    description = `Loading ${part}...`,
    showLoading = true
  } = options;
  
  if (typeof token !== "string") token = await token;
  
  if (showLoading) {
    adminLoading.startOperation({
      id: operationId,
      type: 'data',
      description
    });
  }
  
  try {
    const response = await _fetch(`/api/admin/${part}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch ${part}: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`Failed to fetch ${part}:`, error);
    throw error;
  } finally {
    if (showLoading) {
      adminLoading.endOperation(operationId);
    }
  }
}

export async function invalidateWithLoading(
  invalidateFn: () => Promise<void>,
  description = 'Refreshing data...'
) {
  const operationId = `invalidate-${Date.now()}`;
  
  adminLoading.startOperation({
    id: operationId,
    type: 'data',
    description
  });
  
  try {
    await invalidateFn();
  } finally {
    adminLoading.endOperation(operationId);
  }
}