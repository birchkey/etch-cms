export class ApiError extends Error {
  fieldErrors?: Record<string, string>;
  constructor(message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.fieldErrors = fieldErrors;
  }
}

const BASE = '/api';

// Mutex to prevent multiple concurrent refresh attempts
let refreshPromise: Promise<boolean> | null = null;
// Once a refresh fails, suppress further attempts and redirects within this page load
let sessionInvalid = false;

async function doRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    return res.ok;
  } catch {
    return false;
  }
}

function attemptRefresh(): Promise<boolean> {
  if (sessionInvalid) return Promise.resolve(false);
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

export function clearUserInfo() {
  localStorage.removeItem('cms_user');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  let res = await fetch(`${BASE}${path}`, { ...options, headers, credentials: 'include' });

  // On 401, attempt a silent token refresh and retry once
  if (res.status === 401 && !path.startsWith('/auth/')) {
    const refreshed = await attemptRefresh();
    if (refreshed) {
      res = await fetch(`${BASE}${path}`, { ...options, headers, credentials: 'include' });
    } else {
      if (!sessionInvalid) {
        sessionInvalid = true;
        clearUserInfo();
        window.location.href = '/login';
      }
      throw new Error('Session expired');
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string; fieldErrors?: Record<string, string> };
    throw new ApiError(err.error ?? res.statusText, err.fieldErrors);
  }
  return res.json() as Promise<T>;
}

async function requestBlob(path: string): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`${BASE}${path}`, { credentials: 'include' });
  if (!res.ok) throw new Error(res.statusText);
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename="([^"]+)"/);
  return { blob: await res.blob(), filename: match?.[1] ?? 'export' };
}

// Shared paginated response type
export interface PaginatedResponse<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; pages: number; has_next: boolean };
}

// Auth
export const authApi = {
  login: (username: string, password: string) =>
    request<{ role: 'admin' | 'editor'; username: string; name: string | null }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () =>
    request<{ ok: true }>('/auth/logout', { method: 'DELETE' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>('/auth/password', {
      method: 'PATCH',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
};

// Users (admin only)
export interface CmsUser {
  id: string;
  username: string;
  name: string;
  role: 'editor';
  created_at: number;
  updated_at: number;
}

export const usersApi = {
  list: () => request<CmsUser[]>('/users'),
  create: (username: string, password: string, name?: string) =>
    request<CmsUser>('/users', { method: 'POST', body: JSON.stringify({ username, password, name }) }),
  updateName: (id: string, name: string) =>
    request<CmsUser>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  resetPassword: (id: string, password: string) =>
    request<{ ok: true }>(`/users/${id}/password`, { method: 'PATCH', body: JSON.stringify({ password }) }),
  delete: (id: string) => request<{ ok: true }>(`/users/${id}`, { method: 'DELETE' }),
  getPermissions: (id: string) =>
    request<{ contentTypeIds: string[] }>(`/users/${id}/permissions`),
  setPermissions: (id: string, contentTypeIds: string[]) =>
    request<{ contentTypeIds: string[] }>(`/users/${id}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ contentTypeIds }),
    }),
};

// Sub-field definition for repeater fields
export interface RepeaterSubfield {
  id: string;
  name: string;
  slug: string;
  type: 'text' | 'rich_text' | 'image' | 'number' | 'datetime' | 'boolean' | 'select' | 'email' | 'phone' | 'color';
  required: boolean;
  multiple: boolean; // for image and select
  select_options: string | null; // JSON array string
  rich_text_extensions: string | null; // JSON array string
  phone_format: 'us' | 'international' | null;
}

// Content types
export interface Field {
  id: string;
  content_type_id: string;
  name: string;
  slug: string;
  type: 'text' | 'rich_text' | 'image' | 'number' | 'datetime' | 'boolean' | 'relation' | 'select' | 'email' | 'phone' | 'color' | 'repeater';
  required: number;
  sort_order: number;
  relation_content_type_id: string | null;
  relation_cardinality: 'one' | 'many' | null;
  multiple: number; // 0 or 1, for image and select fields
  rich_text_extensions: string | null; // JSON array of enabled extension keys, null = all
  select_options: string | null; // JSON array of option strings
  min_length: number | null;
  max_length: number | null;
  min_value: number | null;
  max_value: number | null;
  pattern: string | null;
  phone_format: 'us' | 'international' | null;
  repeater_subfields: string | null; // JSON array of RepeaterSubfield definitions
  created_at: number;
}

export interface ContentType {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  preview_url: string | null;
  created_at: number;
  updated_at: number;
  fields?: Field[];
}

export interface FieldInput {
  id?: string;
  name: string;
  slug?: string;
  type: string;
  required?: boolean;
  sort_order?: number;
  relation_content_type_id?: string | null;
  relation_cardinality?: 'one' | 'many' | null;
  multiple?: boolean;
  rich_text_extensions?: string | null;
  select_options?: string | null;
  min_length?: number | null;
  max_length?: number | null;
  min_value?: number | null;
  max_value?: number | null;
  pattern?: string | null;
  phone_format?: 'us' | 'international' | null;
  repeater_subfields?: string | null;
}

export const contentTypesApi = {
  list: () => request<ContentType[]>('/content-types'),
  get: (id: string) => request<ContentType>(`/content-types/${id}`),
  create: (data: { name: string; slug?: string; description?: string; preview_url?: string | null; fields?: FieldInput[] }) =>
    request<ContentType>('/content-types', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: { name?: string; slug?: string; description?: string; preview_url?: string | null; fields?: FieldInput[] }) =>
    request<ContentType>(`/content-types/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => request<{ ok: true }>(`/content-types/${id}`, { method: 'DELETE' }),
  listEntries: (typeId: string, opts?: { status?: string; page?: number; limit?: number; sort_by?: string; sort_dir?: 'asc' | 'desc'; q?: string }) => {
    const params = new URLSearchParams();
    if (opts?.status) params.set('status', opts.status);
    if (opts?.page) params.set('page', String(opts.page));
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.sort_by) params.set('sort_by', opts.sort_by);
    if (opts?.sort_dir) params.set('sort_dir', opts.sort_dir);
    if (opts?.q) params.set('q', opts.q);
    const qs = params.toString();
    return request<PaginatedResponse<Entry>>(`/content-types/${typeId}/entries${qs ? `?${qs}` : ''}`);
  },
  selectEntries: (typeId: string) =>
    request<{ id: string; label: string; status: string }[]>(`/content-types/${typeId}/entries/select`),
  reorderEntries: (typeId: string, ids: string[]) =>
    request<{ ok: true }>(`/content-types/${typeId}/entries/reorder`, {
      method: 'PATCH',
      body: JSON.stringify({ ids }),
    }),
  exportEntries: (typeId: string, opts?: { format?: 'json' | 'csv'; status?: string }) => {
    const params = new URLSearchParams();
    if (opts?.format) params.set('format', opts.format);
    if (opts?.status) params.set('status', opts.status);
    const qs = params.toString();
    return requestBlob(`/content-types/${typeId}/entries/export${qs ? `?${qs}` : ''}`);
  },
};

// Entries
export interface Entry {
  id: string;
  content_type_id: string;
  slug: string | null;
  status: 'draft' | 'published' | 'scheduled';
  has_unpublished_changes: number; // 0 or 1
  created_at: number;
  updated_at: number;
  published_at: number | null;
  scheduled_at: number | null;
  fields: Record<string, unknown>;
  fieldDefs?: Field[];
}

export interface AttentionItem {
  content_type_id: string;
  content_type_name: string;
  content_type_slug: string;
  draft_count: number;
  scheduled_count: number;
  changes_count: number;
}

export interface PublishResult extends Entry {
  warnings: string[];
  fieldErrors?: Record<string, string>;
}

export interface EntryCount {
  count: number;
  published: number;
  draft: number;
  scheduled: number;
}

export interface RecentEntry {
  id: string;
  status: 'draft' | 'published' | 'scheduled';
  updated_at: number;
  slug: string | null;
  content_type_id: string;
  content_type_name: string;
  content_type_slug: string;
  label: string;
}

export interface UpcomingEntry {
  id: string;
  scheduled_at: number;
  slug: string | null;
  content_type_id: string;
  content_type_name: string;
  label: string;
}

export const entriesApi = {
  count: () => request<EntryCount>('/entries/count'),
  attention: () => request<AttentionItem[]>('/entries/attention'),
  recent: () => request<RecentEntry[]>('/entries/recent'),
  upcoming: () => request<UpcomingEntry[]>('/entries/upcoming'),
  create: (data: { content_type_id: string; slug?: string | null; fields?: Record<string, unknown> }) =>
    request<Entry>('/entries', { method: 'POST', body: JSON.stringify(data) }),
  get: (id: string) => request<Entry>(`/entries/${id}`),
  update: (id: string, data: { slug?: string | null; fields?: Record<string, unknown> }) =>
    request<Entry>(`/entries/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  publish: (id: string) => request<PublishResult>(`/entries/${id}/publish`, { method: 'PATCH' }),
  unpublish: (id: string) => request<Entry>(`/entries/${id}/unpublish`, { method: 'PATCH' }),
  schedule: (id: string, scheduled_at: number) =>
    request<Entry>(`/entries/${id}/schedule`, { method: 'PATCH', body: JSON.stringify({ scheduled_at }) }),
  unschedule: (id: string) => request<Entry>(`/entries/${id}/unschedule`, { method: 'PATCH' }),
  duplicate: (id: string) => request<Entry>(`/entries/${id}/duplicate`, { method: 'POST' }),
  previewToken: (id: string) => request<{ token: string; url: string }>(`/entries/${id}/preview-token`, { method: 'POST' }),
  delete: (id: string) => request<{ ok: true }>(`/entries/${id}`, { method: 'DELETE' }),
};

// Webhooks
export interface Webhook {
  id: string;
  url: string;
  secret_hint: string; // last 4 chars only, e.g. "...a3f2"
  enabled: number; // 0 or 1
  created_at: number;
  updated_at: number;
}

// Returned only on creation — contains the full secret (shown once)
export interface WebhookCreated extends Omit<Webhook, 'secret_hint'> {
  secret: string;
}

export interface WebhookDelivery {
  id: string;
  webhook_id: string;
  event: string;
  status_code: number | null;
  success: number; // 0 or 1
  error: string | null;
  duration_ms: number;
  created_at: number;
}

export const webhooksApi = {
  list: () => request<Webhook[]>('/webhooks'),
  create: (url: string) =>
    request<WebhookCreated>('/webhooks', { method: 'POST', body: JSON.stringify({ url }) }),
  update: (id: string, data: { url?: string; enabled?: boolean }) =>
    request<Webhook>(`/webhooks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) => request<{ ok: true }>(`/webhooks/${id}`, { method: 'DELETE' }),
  deliveries: (id: string) => request<WebhookDelivery[]>(`/webhooks/${id}/deliveries`),
  test: (id: string) =>
    request<{ ok: boolean; status?: number; error?: string }>(`/webhooks/${id}/test`, { method: 'POST' }),
};

// Audit Log
export interface AuditLog {
  id: string;
  actor_id: string;
  actor_name: string | null;
  actor_role: 'admin' | 'editor';
  action: string;
  resource_type: string;
  resource_id: string;
  resource_label: string | null;
  details: string | null;
  created_at: number;
}

export const auditLogApi = {
  list: (opts?: { page?: number; limit?: number; resource_type?: string }) => {
    const params = new URLSearchParams();
    if (opts?.page) params.set('page', String(opts.page));
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.resource_type) params.set('resource_type', opts.resource_type);
    const qs = params.toString();
    return request<PaginatedResponse<AuditLog>>(`/audit-logs${qs ? `?${qs}` : ''}`);
  },
};

// Settings
export const settingsApi = {
  update: (data: Record<string, unknown>) =>
    request<Record<string, unknown>>('/settings', { method: 'PUT', body: JSON.stringify(data) }),
};

// Assets
export interface Asset {
  id: string;
  filename: string;
  original_name: string;
  content_type: string;
  size: number;
  r2_key: string;
  alt_text: string | null;
  created_at: number;
}

export const assetsApi = {
  list: (opts?: { page?: number; limit?: number; search?: string; filename?: string }) => {
    const params = new URLSearchParams();
    if (opts?.page) params.set('page', String(opts.page));
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.search) params.set('search', opts.search);
    if (opts?.filename) params.set('filename', opts.filename);
    const qs = params.toString();
    return request<PaginatedResponse<Asset>>(`/assets${qs ? `?${qs}` : ''}`);
  },
  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<Asset>('/assets', { method: 'POST', body: form });
  },
  update: (id: string, data: { alt_text?: string | null }) =>
    request<Asset>(`/assets/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) => request<{ ok: true }>(`/assets/${id}`, { method: 'DELETE' }),
  register: (data: { r2_key: string; alt_text?: string | null }) =>
    request<Asset>('/assets/register', { method: 'POST', body: JSON.stringify(data) }),
  url: (r2Key: string) => `/r2/${r2Key.replace(/^assets\//, '')}`,
};
