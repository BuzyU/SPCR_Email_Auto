let currentCsrfToken = '';

export function setClientCsrfToken(token: string) {
  currentCsrfToken = token;
}

export async function apiFetch<T = any>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && currentCsrfToken) {
    headers['X-CSRF-Token'] = currentCsrfToken;
  }

  const resp = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.message || data?.error || `Request failed (${resp.status})`);
  }
  return data as T;
}

