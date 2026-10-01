/**
 * compat9/directusClient.ts
 *
 * A lightweight D9-compatible REST client that replaces @directus/sdk v18 calls
 * with fetch-based requests against the D9 (Directus 9/10) API.
 *
 * D9 uses the Directus v9 data model:
 *   - Users have `role` (UUID) — NOT `policies`
 *   - Permissions are embedded on roles or stored in directus_permissions
 *   - No directus_policies system collection
 *   - No /permissions/me endpoint (use /users/me instead)
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

type RequestHeaders = Record<string, string>;

export interface D9Client {
  /** Base URL (origin), e.g. https://example.com */
  url: { origin: string };

  /** Perform a typed REST request */
  request: <T>(command: D9Command<T>) => Promise<T>;

  /** Login (email + password) → stores JWT */
  login: (email: string, password: string) => Promise<void>;

  /** Refresh the access token using the stored refresh token */
  refresh: () => Promise<void>;

  /** Logout — invalidate refresh token */
  logout: () => Promise<void>;

  /** Set a static API token (static-token auth) */
  setToken: (token: string) => Promise<void>;

  /** Get the current access/API token string */
  getToken: () => Promise<string | null>;
}

export interface D9Command<T> {
  method: "GET" | "POST" | "PATCH" | "DELETE" | "SEARCH";
  path: string;
  body?: unknown;
  /** Optional query parameters */
  params?: Record<string, string | string[] | undefined>;
  /** Internal: response transformer */
  transform?: (raw: unknown) => T;
}

// ─── Token Storage ──────────────────────────────────────────────────────────────

interface StoredAuth {
  accessToken: string | null;
  refreshToken: string | null;
  expires: number | null; // ms timestamp
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function buildUrl(base: string, path: string, params?: Record<string, string | string[] | undefined>): string {
  let url = `${base.replace(/\/+$/, "")}/${path.replace(/^\//, "")}`;
  if (params) {
    const sep = url.includes("?") ? "&" : "?";
    const parts: string[] = [];
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) {
        for (const item of v) parts.push(`${encodeURIComponent(k)}[]=${encodeURIComponent(String(item))}`);
      } else {
        parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
      }
    }
    if (parts.length) url += sep + parts.join("&");
  }
  return url;
}

class D9ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "D9ApiError";
    this.status = status;
    this.code = code;
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let body: { errors?: Array<{ message: string; extensions: { code: string } }> } | Record<string, unknown> = {};
    try {
      body = await response.json() as any;
    } catch { /* ignore */ }
    const errors = Array.isArray(body?.errors) ? body.errors : [];
    const err = errors[0];
    const code = err?.extensions?.code ?? "UNKNOWN";
    const message = err?.message ?? response.statusText;
    throw new D9ApiError(response.status, code, message);
  }
  // 204 No Content
  if (response.status === 204) return undefined as unknown as T;
  const json = await response.json();
  // Directus wraps data in { data: ... } for most endpoints
  if (json && typeof json === "object" && "data" in json) {
    return json.data as T;
  }
  return json as T;
}

// ─── Client Factory ─────────────────────────────────────────────────────────────

export function createD9Client(baseUrl: string, storage: {
  get: () => Promise<StoredAuth | null>;
  set: (auth: StoredAuth) => Promise<void>;
  clear: () => Promise<void>;
}): D9Client {
  const origin = baseUrl.replace(/\/+$/, "");

  const getAccessToken = async (): Promise<string | null> => {
    const s = await storage.get();
    return s?.accessToken ?? null;
  };

  const buildHeaders = async (extra: RequestHeaders = {}): Promise<RequestHeaders> => {
    const token = await getAccessToken();
    const headers: RequestHeaders = {
      "Content-Type": "application/json",
      ...extra,
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return headers;
  };

  const request = async <T>(command: D9Command<T>): Promise<T> => {
    const url = buildUrl(origin, command.path, command.params);
    const headers = await buildHeaders();
    const options: RequestInit = {
      method: command.method,
      headers,
    };
    if (command.body !== undefined && command.method !== "GET" && command.method !== "SEARCH") {
      options.body = JSON.stringify(command.body);
    }
    // SEARCH allows body
    if (command.method === "SEARCH" && command.body !== undefined) {
      options.body = JSON.stringify(command.body);
    }
    const response = await fetch(url, options);
    const data = await handleResponse(response);
    return command.transform ? command.transform(data) : data as T;
  };

  const login = async (email: string, password: string): Promise<void> => {
    const response = await fetch(`${origin}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, mode: "json" }),
    });
    const json = await handleResponse<{
      access_token: string;
      refresh_token: string;
      expires: number;
    }>(response);
    await storage.set({
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expires: Date.now() + json.expires,
    });
  };

  const refresh = async (): Promise<void> => {
    const s = await storage.get();
    if (!s?.refreshToken) throw new D9ApiError(401, "NO_REFRESH_TOKEN", "No refresh token available");
    const response = await fetch(`${origin}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: s.refreshToken, mode: "json" }),
    });
    const json = await handleResponse<{
      access_token: string;
      refresh_token: string;
      expires: number;
    }>(response);
    await storage.set({
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expires: Date.now() + json.expires,
    });
  };

  const logout = async (): Promise<void> => {
    const s = await storage.get();
    try {
      if (s?.refreshToken) {
        await fetch(`${origin}/auth/logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: s.refreshToken }),
        });
      }
    } finally {
      await storage.clear();
    }
  };

  const setToken = async (token: string): Promise<void> => {
    await storage.set({
      accessToken: token,
      refreshToken: null,
      expires: null,
    });
  };

  const getToken = async (): Promise<string | null> => {
    const s = await storage.get();
    return s?.accessToken ?? null;
  };

  return {
    url: { origin },
    request,
    login,
    refresh,
    logout,
    setToken,
    getToken,
  };
}

// ─── D9 Command Builders ────────────────────────────────────────────────────────

export namespace commands {
  // ─── Auth ───────────────────────────────────────────────────────────────────

  /** GET /users/me */
  export const readMe = <T = unknown>(): D9Command<T> => ({
    method: "GET",
    path: "/users/me",
  });

  /** GET /users/:id */
  export const readUser = <T = unknown>(id: string): D9Command<T> => ({
    method: "GET",
    path: `/users/${id}`,
  });

  /** GET /users */
  export const readUsers = <T = unknown>(query?: Record<string, unknown>): D9Command<T> => ({
    method: "SEARCH",
    path: "/users",
    body: query ? { query } : undefined,
  });

  /** POST /users */
  export const createUsers = <T = unknown>(data: Record<string, unknown>[]): D9Command<T> => ({
    method: "POST",
    path: "/users",
    body: data,
  });

  /** PATCH /users/:id */
  export const updateUser = <T = unknown>(id: string, data: Record<string, unknown>): D9Command<T> => ({
    method: "PATCH",
    path: `/users/${id}`,
    body: data,
  });

  /** PATCH /users/me */
  export const updateMe = <T = unknown>(data: Record<string, unknown>): D9Command<T> => ({
    method: "PATCH",
    path: "/users/me",
    body: data,
  });

  /** PATCH /users (bulk) */
  export const updateUsers = <T = unknown>(ids: string[], data: Record<string, unknown>): D9Command<T> => ({
    method: "PATCH",
    path: "/users",
    body: { keys: ids, data },
  });

  /** DELETE /users/:id */
  export const deleteUser = <T = unknown>(id: string): D9Command<T> => ({
    method: "DELETE",
    path: `/users/${id}`,
  });

  /** DELETE /users (bulk) */
  export const deleteUsers = <T = unknown>(ids: string[]): D9Command<T> => ({
    method: "DELETE",
    path: "/users",
    body: ids,
  });

  // ─── Roles ──────────────────────────────────────────────────────────────────

  /** GET /roles/:id */
  export const readRole = <T = unknown>(id: string): D9Command<T> => ({
    method: "GET",
    path: `/roles/${id}`,
  });

  /** GET /roles */
  export const readRoles = <T = unknown>(query?: Record<string, unknown>): D9Command<T> => ({
    method: "SEARCH",
    path: "/roles",
    body: query ? { query } : undefined,
  });

  /** POST /roles */
  export const createRole = <T = unknown>(data: Record<string, unknown>): D9Command<T> => ({
    method: "POST",
    path: "/roles",
    body: data,
  });

  /** PATCH /roles/:id */
  export const updateRole = <T = unknown>(id: string, data: Record<string, unknown>): D9Command<T> => ({
    method: "PATCH",
    path: `/roles/${id}`,
    body: data,
  });

  /** DELETE /roles/:id */
  export const deleteRole = <T = unknown>(id: string): D9Command<T> => ({
    method: "DELETE",
    path: `/roles/${id}`,
  });

  /** DELETE /roles (bulk) */
  export const deleteRoles = <T = unknown>(ids: string[]): D9Command<T> => ({
    method: "DELETE",
    path: "/roles",
    body: ids,
  });

  // ─── Items (user-created collections) ───────────────────────────────────────

  /** GET /items/:collection */
  export const readItems = <T = unknown>(collection: string, query?: Record<string, unknown>): D9Command<T> => ({
    method: "SEARCH",
    path: `/items/${collection}`,
    body: query ? { query } : undefined,
  });

  /** GET /items/:collection/:id */
  export const readItem = <T = unknown>(collection: string, id: string | number, query?: Record<string, unknown>): D9Command<T> => ({
    method: "GET",
    path: `/items/${collection}/${id}`,
    params: query ? undefined : undefined,
    body: undefined,
    transform: undefined,
  });

  /** GET singleton */
  export const readSingleton = <T = unknown>(collection: string, query?: Record<string, unknown>): D9Command<T> => ({
    method: "GET",
    path: `/items/${collection}`,
    params: query as Record<string, string> | undefined,
  });

  /** POST /items/:collection */
  export const createItem = <T = unknown>(collection: string, data: Record<string, unknown>): D9Command<T> => ({
    method: "POST",
    path: `/items/${collection}`,
    body: data,
  });

  /** PATCH /items/:collection/:id */
  export const updateItem = <T = unknown>(collection: string, id: string | number, data: Record<string, unknown>): D9Command<T> => ({
    method: "PATCH",
    path: `/items/${collection}/${id}`,
    body: data,
  });

  /** PATCH /items/:collection (bulk) */
  export const updateItems = <T = unknown>(collection: string, keys: (string | number)[], data: Record<string, unknown>): D9Command<T> => ({
    method: "PATCH",
    path: `/items/${collection}`,
    body: { keys, data },
  });

  /** PATCH /items/:collection (singleton) */
  export const updateSingleton = <T = unknown>(collection: string, data: Record<string, unknown>): D9Command<T> => ({
    method: "PATCH",
    path: `/items/${collection}`,
    body: data,
  });

  /** DELETE /items/:collection/:id */
  export const deleteItem = <T = unknown>(collection: string, id: string | number): D9Command<T> => ({
    method: "DELETE",
    path: `/items/${collection}/${id}`,
  });

  /** DELETE /items/:collection (bulk) */
  export const deleteItems = <T = unknown>(collection: string, ids: (string | number)[]): D9Command<T> => ({
    method: "DELETE",
    path: `/items/${collection}`,
    body: ids,
  });

  // ─── Collections ────────────────────────────────────────────────────────────

  /** GET /collections */
  export const readCollections = <T = unknown>(): D9Command<T> => ({
    method: "GET",
    path: "/collections",
  });

  /** GET /collections/:collection */
  export const readCollection = <T = unknown>(collection: string): D9Command<T> => ({
    method: "GET",
    path: `/collections/${collection}`,
  });

  /** POST /collections */
  export const createCollection = <T = unknown>(data: Record<string, unknown>): D9Command<T> => ({
    method: "POST",
    path: "/collections",
    body: data,
  });

  /** PATCH /collections/:collection */
  export const updateCollection = <T = unknown>(collection: string, data: Record<string, unknown>): D9Command<T> => ({
    method: "PATCH",
    path: `/collections/${collection}`,
    body: data,
  });

  /** DELETE /collections/:collection */
  export const deleteCollection = <T = unknown>(collection: string): D9Command<T> => ({
    method: "DELETE",
    path: `/collections/${collection}`,
  });

  // ─── Fields ─────────────────────────────────────────────────────────────────

  /** GET /fields */
  export const readFields = <T = unknown>(): D9Command<T> => ({
    method: "GET",
    path: "/fields",
  });

  /** GET /fields/:collection */
  export const readFieldsByCollection = <T = unknown>(collection: string): D9Command<T> => ({
    method: "GET",
    path: `/fields/${collection}`,
  });

  /** GET /fields/:collection/:field */
  export const readField = <T = unknown>(collection: string, field: string): D9Command<T> => ({
    method: "GET",
    path: `/fields/${collection}/${field}`,
  });

  /** POST /fields/:collection */
  export const createField = <T = unknown>(collection: string, data: Record<string, unknown>): D9Command<T> => ({
    method: "POST",
    path: `/fields/${collection}`,
    body: data,
  });

  /** PATCH /fields/:collection/:field */
  export const updateField = <T = unknown>(collection: string, field: string, data: Record<string, unknown>): D9Command<T> => ({
    method: "PATCH",
    path: `/fields/${collection}/${field}`,
    body: data,
  });

  /** DELETE /fields/:collection/:field */
  export const deleteField = <T = unknown>(collection: string, field: string): D9Command<T> => ({
    method: "DELETE",
    path: `/fields/${collection}/${field}`,
  });

  // ─── Relations ──────────────────────────────────────────────────────────────

  /** GET /relations */
  export const readRelations = <T = unknown>(): D9Command<T> => ({
    method: "GET",
    path: "/relations",
  });

  /** GET /relations/:id */
  export const readRelation = <T = unknown>(id: string | number): D9Command<T> => ({
    method: "GET",
    path: `/relations/${id}`,
  });

  // ─── Settings ───────────────────────────────────────────────────────────────

  /** GET /settings */
  export const readSettings = <T = unknown>(): D9Command<T> => ({
    method: "GET",
    path: "/settings",
  });

  /** PATCH /settings */
  export const updateSettings = <T = unknown>(data: Record<string, unknown>): D9Command<T> => ({
    method: "PATCH",
    path: "/settings",
    body: data,
  });

  // ─── Server ─────────────────────────────────────────────────────────────────

  /** GET /server/health */
  export const serverHealth = <T = unknown>(): D9Command<T> => ({
    method: "GET",
    path: "/server/health",
  });

  /** GET /server/info */
  export const serverInfo = <T = unknown>(): D9Command<T> => ({
    method: "GET",
    path: "/server/info",
  });

  // ─── Permissions (D9 v9 style — stored in directus_permissions) ────────────

  /** GET /permissions */
  export const readPermissions = <T = unknown>(): D9Command<T> => ({
    method: "GET",
    path: "/permissions",
  });

  /** GET /permissions/me — NOT available in D9, included for compat */
  export const readPermissionsMe = <T = unknown>(): D9Command<T> => ({
    method: "GET",
    path: "/permissions/me",
  });

  /** POST /permissions */
  export const createPermission = <T = unknown>(data: Record<string, unknown>): D9Command<T> => ({
    method: "POST",
    path: "/permissions",
    body: data,
  });

  /** PATCH /permissions/:id */
  export const updatePermission = <T = unknown>(id: string | number, data: Record<string, unknown>): D9Command<T> => ({
    method: "PATCH",
    path: `/permissions/${id}`,
    body: data,
  });

  /** DELETE /permissions/:id */
  export const deletePermission = <T = unknown>(id: string | number): D9Command<T> => ({
    method: "DELETE",
    path: `/permissions/${id}`,
  });

  /** DELETE /permissions (bulk) */
  export const deletePermissions = <T = unknown>(ids: (string | number)[]): D9Command<T> => ({
    method: "DELETE",
    path: "/permissions",
    body: ids,
  });

  // ─── Files ──────────────────────────────────────────────────────────────────

  /** GET /files */
  export const readFiles = <T = unknown>(query?: Record<string, unknown>): D9Command<T> => ({
    method: "SEARCH",
    path: "/files",
    body: query ? { query } : undefined,
  });

  /** GET /files/:id */
  export const readFile = <T = unknown>(id: string): D9Command<T> => ({
    method: "GET",
    path: `/files/${id}`,
  });

  /** DELETE /files/:id */
  export const deleteFile = <T = unknown>(id: string): D9Command<T> => ({
    method: "DELETE",
    path: `/files/${id}`,
  });

  /** DELETE /files (bulk) */
  export const deleteFiles = <T = unknown>(ids: string[]): D9Command<T> => ({
    method: "DELETE",
    path: "/files",
    body: ids,
  });

  // ─── Presets ────────────────────────────────────────────────────────────────

  /** GET /presets */
  export const readPresets = <T = unknown>(): D9Command<T> => ({
    method: "GET",
    path: "/presets",
  });

  /** POST /presets */
  export const createPreset = <T = unknown>(data: Record<string, unknown>): D9Command<T> => ({
    method: "POST",
    path: "/presets",
    body: data,
  });

  /** PATCH /presets/:id */
  export const updatePreset = <T = unknown>(id: string | number, data: Record<string, unknown>): D9Command<T> => ({
    method: "PATCH",
    path: `/presets/${id}`,
    body: data,
  });

  /** DELETE /presets/:id */
  export const deletePreset = <T = unknown>(id: string | number): D9Command<T> => ({
    method: "DELETE",
    path: `/presets/${id}`,
  });

  // ─── Activity ───────────────────────────────────────────────────────────────

  /** GET /activity */
  export const readActivity = <T = unknown>(): D9Command<T> => ({
    method: "GET",
    path: "/activity",
  });

  // ─── Flows ──────────────────────────────────────────────────────────────────

  /** GET /flows */
  export const readFlows = <T = unknown>(query?: Record<string, unknown>): D9Command<T> => ({
    method: "SEARCH",
    path: "/flows",
    body: query ? { query } : undefined,
  });

  /** POST /flows */
  export const createFlow = <T = unknown>(data: Record<string, unknown>): D9Command<T> => ({
    method: "POST",
    path: "/flows",
    body: data,
  });

  /** PATCH /flows/:id */
  export const updateFlow = <T = unknown>(id: string, data: Record<string, unknown>): D9Command<T> => ({
    method: "PATCH",
    path: `/flows/${id}`,
    body: data,
  });

  /** DELETE /flows/:id */
  export const deleteFlow = <T = unknown>(id: string): D9Command<T> => ({
    method: "DELETE",
    path: `/flows/${id}`,
  });

  // ─── Operations ─────────────────────────────────────────────────────────────

  /** GET /operations */
  export const readOperations = <T = unknown>(query?: Record<string, unknown>): D9Command<T> => ({
    method: "SEARCH",
    path: "/operations",
    body: query ? { query } : undefined,
  });

  /** POST /operations */
  export const createOperation = <T = unknown>(data: Record<string, unknown>): D9Command<T> => ({
    method: "POST",
    path: "/operations",
    body: data,
  });

  /** PATCH /operations/:id */
  export const updateOperation = <T = unknown>(id: string, data: Record<string, unknown>): D9Command<T> => ({
    method: "PATCH",
    path: `/operations/${id}`,
    body: data,
  });

  /** DELETE /operations/:id */
  export const deleteOperation = <T = unknown>(id: string): D9Command<T> => ({
    method: "DELETE",
    path: `/operations/${id}`,
  });

  // ─── Folders ────────────────────────────────────────────────────────────────

  /** GET /folders */
  export const readFolders = <T = unknown>(): D9Command<T> => ({
    method: "GET",
    path: "/folders",
  });

  // ─── Notifications ──────────────────────────────────────────────────────────

  /** GET /notifications */
  export const readNotifications = <T = unknown>(query?: Record<string, unknown>): D9Command<T> => ({
    method: "SEARCH",
    path: "/notifications",
    body: query ? { query } : undefined,
  });

  // ─── Revisions ──────────────────────────────────────────────────────────────

  /** GET /revisions */
  export const readRevisions = <T = unknown>(query?: Record<string, unknown>): D9Command<T> => ({
    method: "SEARCH",
    path: "/revisions",
    body: query ? { query } : undefined,
  });

  // ─── Shares ─────────────────────────────────────────────────────────────────

  /** GET /shares */
  export const readShares = <T = unknown>(query?: Record<string, unknown>): D9Command<T> => ({
    method: "SEARCH",
    path: "/shares",
    body: query ? { query } : undefined,
  });

  // ─── Aggregation / Raw ──────────────────────────────────────────────────────

  /**
   * D9 supports: GET /items/:collection?aggregate[count]=*
   * This helper builds a command for that.
   */
  export const aggregate = <T = unknown>(
    collection: string,
    options: { aggregate: Record<string, string>; query?: Record<string, unknown> }
  ): D9Command<T> => {
    const params: Record<string, string> = {};
    for (const [fn, field] of Object.entries(options.aggregate)) {
      params[`aggregate[${fn}]`] = field;
    }
    // Pass remaining query as params
    if (options.query) {
      if (options.query.filter) params["filter"] = JSON.stringify(options.query.filter);
      if (options.query.search) params["search"] = String(options.query.search);
    }
    return {
      method: "GET",
      path: `/items/${collection}`,
      params,
    };
  };

  // ─── Upload / Import Files ──────────────────────────────────────────────────

  /** POST /files (multipart upload) */
  export const uploadFiles = <T = unknown>(formData: FormData): D9Command<T> => ({
    method: "POST",
    path: "/files",
    body: formData,
  });

  /** POST /files/import */
  export const importFile = <T = unknown>(url: string): D9Command<T> => ({
    method: "POST",
    path: "/files/import",
    body: { url },
  });

  // ─── Auth Providers ─────────────────────────────────────────────────────────

  /** GET /auth */
  export const readProviders = <T = unknown>(): D9Command<T> => ({
    method: "GET",
    path: "/auth",
  });
}

// ─── SDK-Style Type Names (mapped to D9 equivalents) ────────────────────────────

export type CoreSchema = Record<string, any>;
export type DirectusUser = Record<string, any>;
export type DirectusRole = Record<string, any>;
export type DirectusFile = Record<string, any>;
export type DirectusPermission = Record<string, any>;

export interface AuthenticationData {
  access_token: string;
  refresh_token: string;
  expires: number;
}