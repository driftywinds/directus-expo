/**
 * compat9/shim.ts
 *
 * A compatibility shim that re-exports everything from the original @directus/sdk
 * but using the D9 client underneath. This allows the rest of the app to keep
 * `import { ... } from "@directus/sdk"` while the actual HTTP calls go to the D9 API.
 *
 * To use:
 *   1. Create a symlink or configure your package resolver to point
 *      "@directus/sdk" → this file, e.g. in tsconfig.json:
 *      {
 *        "paths": {
 *          "@directus/sdk": ["./compat9/shim.ts"]
 *        }
 *      }
 *
 *   2. Or replace `import { ... } from "@directus/sdk"` with
 *      `import { ... } from "@/compat9/shim"` in all files.
 */

// Re-export everything from the D9 client
export {
  createD9Client,
  commands,
  type D9Client,
  type D9Command,
  type CoreSchema,
  type DirectusUser,
  type DirectusRole,
  type DirectusFile,
  type DirectusPermission,
  type AuthenticationData,
} from "./directusClient";

// --- Backward-compatible aliases for SDK v18 names mapped to D9 commands ---

import { commands } from "./directusClient";
import type { D9Command } from "./directusClient";

// Auth
export const readMe: <T = unknown>() => D9Command<T> = commands.readMe;
export const readUser: <T = unknown>(id: string) => D9Command<T> = commands.readUser;
export const readUsers: <T = unknown>(query?: Record<string, unknown>) => D9Command<T> = commands.readUsers;
export const createUsers: <T = unknown>(data: Record<string, unknown>[]) => D9Command<T> = commands.createUsers;
export const updateUser: <T = unknown>(id: string, data: Record<string, unknown>) => D9Command<T> = commands.updateUser;
export const updateMe: <T = unknown>(data: Record<string, unknown>) => D9Command<T> = commands.updateMe;
export const updateUsers: <T = unknown>(ids: string[], data: Record<string, unknown>) => D9Command<T> = commands.updateUsers;
export const deleteUser: <T = unknown>(id: string) => D9Command<T> = commands.deleteUser;
export const deleteUsers: <T = unknown>(ids: string[]) => D9Command<T> = commands.deleteUsers;

// Roles
export const readRole: <T = unknown>(id: string) => D9Command<T> = commands.readRole;
export const readRoles: <T = unknown>(query?: Record<string, unknown>) => D9Command<T> = commands.readRoles;
export const createRole: <T = unknown>(data: Record<string, unknown>) => D9Command<T> = commands.createRole;
export const updateRole: <T = unknown>(id: string, data: Record<string, unknown>) => D9Command<T> = commands.updateRole;
export const deleteRole: <T = unknown>(id: string) => D9Command<T> = commands.deleteRole;
export const deleteRoles: <T = unknown>(ids: string[]) => D9Command<T> = commands.deleteRoles;

// Items
export const readItems: <T = unknown>(collection: string, query?: Record<string, unknown>) => D9Command<T> = commands.readItems;
export const readItem: <T = unknown>(collection: string, id: string | number, query?: Record<string, unknown>) => D9Command<T> = commands.readItem;
export const readSingleton: <T = unknown>(collection: string, query?: Record<string, unknown>) => D9Command<T> = commands.readSingleton;
export const createItem: <T = unknown>(collection: string, data: Record<string, unknown>) => D9Command<T> = commands.createItem;
export const updateItem: <T = unknown>(collection: string, id: string | number, data: Record<string, unknown>) => D9Command<T> = commands.updateItem;
export const updateItems: <T = unknown>(collection: string, keys: (string | number)[], data: Record<string, unknown>) => D9Command<T> = commands.updateItems;
export const updateSingleton: <T = unknown>(collection: string, data: Record<string, unknown>) => D9Command<T> = commands.updateSingleton;
export const deleteItem: <T = unknown>(collection: string, id: string | number) => D9Command<T> = commands.deleteItem;
export const deleteItems: <T = unknown>(collection: string, ids: (string | number)[]) => D9Command<T> = commands.deleteItems;

// Collections
export const readCollections: <T = unknown>() => D9Command<T> = commands.readCollections;
export const readCollection: <T = unknown>(collection: string) => D9Command<T> = commands.readCollection;
export const createCollection: <T = unknown>(data: Record<string, unknown>) => D9Command<T> = commands.createCollection;
export const updateCollection: <T = unknown>(collection: string, data: Record<string, unknown>) => D9Command<T> = commands.updateCollection;
export const deleteCollection: <T = unknown>(collection: string) => D9Command<T> = commands.deleteCollection;

// Fields
export const readFields: <T = unknown>() => D9Command<T> = commands.readFields;
export const readFieldsByCollection: <T = unknown>(collection: string) => D9Command<T> = commands.readFieldsByCollection;
export const readField: <T = unknown>(collection: string, field: string) => D9Command<T> = commands.readField;
export const createField: <T = unknown>(collection: string, data: Record<string, unknown>) => D9Command<T> = commands.createField;
export const updateField: <T = unknown>(collection: string, field: string, data: Record<string, unknown>) => D9Command<T> = commands.updateField;
export const deleteField: <T = unknown>(collection: string, field: string) => D9Command<T> = commands.deleteField;

// Relations
export const readRelations: <T = unknown>() => D9Command<T> = commands.readRelations;
export const readRelation: <T = unknown>(id: string | number) => D9Command<T> = commands.readRelation;

// Settings
export const readSettings: <T = unknown>() => D9Command<T> = commands.readSettings;
export const updateSettings: <T = unknown>(data: Record<string, unknown>) => D9Command<T> = commands.updateSettings;

// Server
export const serverHealth: <T = unknown>() => D9Command<T> = commands.serverHealth;
export const serverInfo: <T = unknown>() => D9Command<T> = commands.serverInfo;

// Permissions
export const readPermissions: <T = unknown>() => D9Command<T> = commands.readPermissions;
export const readPermissionsMe: <T = unknown>() => D9Command<T> = commands.readPermissionsMe;
export const createPermission: <T = unknown>(data: Record<string, unknown>) => D9Command<T> = commands.createPermission;
export const updatePermission: <T = unknown>(id: string | number, data: Record<string, unknown>) => D9Command<T> = commands.updatePermission;
export const deletePermission: <T = unknown>(id: string | number) => D9Command<T> = commands.deletePermission;
export const deletePermissions: <T = unknown>(ids: (string | number)[]) => D9Command<T> = commands.deletePermissions;

// ─── SDK v18 → D9 compatibility shims ──────────────────────────────────────
//
// Directus 10+ uses "policies". D9 uses the v9 model where roles hold admin/app access
// and permissions are stored in directus_permissions.
//
// These shims map policy operations to their D9 equivalents or throw informative errors.

// Policies don't exist in D9; we map these to roles + permissions
export function readPolicyGlobals(): D9Command<any> {
  // D9 doesn't have /permissions/me or policy globals.
  // We return an empty object; the app falls back to admin_access from user's role.
  return { method: "GET", path: "/users/me" } as D9Command<any>;
}

export const readPolicies = readRoles;
export const readPolicy = readRole;
export const createPolicy = createRole;
export const updatePolicy = updateRole;
export const deletePolicy = deleteRole;
export const deletePolicies = deleteRoles;

// ─── Types used by the app from the SDK ─────────────────────────────────────

export type {
  DirectusUser,
  DirectusRole,
  DirectusFile,
  DirectusPermission,
  AuthenticationData,
  CoreSchema,
} from "./directusClient";

export type DirectusPolicy = Record<string, any>;

// ─── SDK type output aliases ───────────────────────────────────────────────

/**
 * These types represent the shape of objects returned by the D9 API.
 * They are intentionally generic since D9 fields/relations/collections
 * follow a standard Directus v9 schema.
 *
 * ReadFieldOutput: a single field definition (from GET /fields/:collection)
 * ReadRelationOutput: a single relation definition (from GET /relations)
 * ReadCollectionOutput: a single collection definition (from GET /collections)
 * ReadPresetOutput: a single preset (from GET /presets)
 */

export type ReadFieldOutput<S extends CoreSchema> = {
  collection: string;
  field: string;
  type: string;
  meta: {
    id?: number;
    collection?: string;
    field?: string;
    special?: string | null;
    interface?: string | null;
    options?: Record<string, any> | null;
    display?: string | null;
    display_options?: Record<string, any> | null;
    readonly?: boolean;
    hidden?: boolean;
    sort?: number | null;
    width?: string;
    translations?: Record<string, string>[] | null;
    note?: string | null;
    required?: boolean;
    [key: string]: any;
  } | null;
  schema: {
    name?: string;
    table?: string;
    data_type?: string;
    default_value?: any;
    max_length?: number | null;
    numeric_precision?: number | null;
    numeric_scale?: number | null;
    is_nullable?: boolean;
    is_primary_key?: boolean;
    has_auto_increment?: boolean;
    foreign_key_column?: string | null;
    foreign_key_table?: string | null;
    comment?: string | null;
    [key: string]: any;
  } | null;
  [key: string]: any;
};

export type ReadRelationOutput<S extends CoreSchema> = {
  collection: string;
  field: string;
  related_collection: string | null;
  schema: {
    table: string;
    column: string;
    foreign_key_table: string;
    foreign_key_column: string;
    constraint_name?: string;
    on_update?: string;
    on_delete?: string;
    [key: string]: any;
  } | null;
  meta: {
    id?: number;
    many_collection?: string;
    many_field?: string;
    one_collection?: string;
    one_field?: string;
    one_collection_field?: string;
    one_allowed_collections?: string[];
    junction_field?: string;
    sort_field?: string;
    one_deselect_action?: string;
    [key: string]: any;
  } | null;
  [key: string]: any;
};

export type ReadCollectionOutput<S extends CoreSchema> = {
  collection: string;
  meta: {
    collection?: string;
    icon?: string | null;
    note?: string | null;
    display_template?: string | null;
    hidden?: boolean;
    singleton?: boolean;
    translations?: Record<string, string>[] | null;
    archive_field?: string | null;
    archive_value?: string | null;
    unarchive_value?: string | null;
    archive_app_filter?: boolean;
    sort_field?: string | null;
    accountability?: string;
    group?: string | null;
    sort?: number | null;
    collapse?: string;
    item_duplication_fields?: any;
    [key: string]: any;
  } | null;
  schema: {
    name: string;
    comment?: string | null;
    [key: string]: any;
  } | null;
  [key: string]: any;
};

export type ReadPresetOutput<S extends CoreSchema> = {
  id: number | string;
  bookmark: string | null;
  user: string | null;
  role: string | null;
  collection: string | null;
  search: string | null;
  filters: Record<string, any>[] | null;
  layout: string | null;
  layout_query: Record<string, any> | null;
  layout_options: Record<string, any> | null;
  [key: string]: any;
};

/** SDK-compat alias for permission check results */
export type ReadUserPermissionsOutput = Record<string, any>;

/** SDK-compat alias for permission item */
export type ReadPermissionOutput = Record<string, any>;

/** D9: read item-level permissions (uses /permissions with collection filter) */
export const readItemPermissions = <T = unknown>(collection: string, id?: string | number | "+"): D9Command<T> => ({
  method: "GET",
  path: `/permissions`,
  params: { "filter[collection][_eq]": collection },
});

// ─── Query type for SDK style ───────────────────────────────────────────────
export interface Query<S extends CoreSchema, T> {
  fields?: string[];
  filter?: Record<string, any>;
  search?: string;
  sort?: string[];
  limit?: number;
  offset?: number;
  page?: number;
  deep?: Record<string, any>;
  meta?: string;
  [key: string]: any;
}

export type RestCommand<T, _S extends CoreSchema> = D9Command<T>;

// ─── Helper for raw requests ────────────────────────────────────────────────
export const rest = <T = unknown>(): { request: (cmd: D9Command<T>) => Promise<T> } => {
  throw new Error("D9 compat: use D9Client directly instead of rest() middleware from SDK.");
};

// ─── Aggregation helper ─────────────────────────────────────────────────────
export const aggregate = commands.aggregate;

// ─── Flow / Operation helpers ───────────────────────────────────────────────
export const readFlows: <T = unknown>(query?: Record<string, unknown>) => D9Command<T> = commands.readFlows;
export const createFlow: <T = unknown>(data: Record<string, unknown>) => D9Command<T> = commands.createFlow;
export const updateFlow: <T = unknown>(id: string, data: Record<string, unknown>) => D9Command<T> = commands.updateFlow;
export const deleteFlow: <T = unknown>(id: string) => D9Command<T> = commands.deleteFlow;
export const readOperations: <T = unknown>(query?: Record<string, unknown>) => D9Command<T> = commands.readOperations;
export const createOperation: <T = unknown>(data: Record<string, unknown>) => D9Command<T> = commands.createOperation;
export const updateOperation: <T = unknown>(id: string, data: Record<string, unknown>) => D9Command<T> = commands.updateOperation;
export const deleteOperation: <T = unknown>(id: string) => D9Command<T> = commands.deleteOperation;

// ─── File helpers ───────────────────────────────────────────────────────────
export const readFiles: <T = unknown>(query?: Record<string, unknown>) => D9Command<T> = commands.readFiles;
export const readFile: <T = unknown>(id: string) => D9Command<T> = commands.readFile;
export const deleteFile: <T = unknown>(id: string) => D9Command<T> = commands.deleteFile;
export const deleteFiles: <T = unknown>(ids: string[]) => D9Command<T> = commands.deleteFiles;
export const uploadFiles: <T = unknown>(formData: FormData) => D9Command<T> = commands.uploadFiles;
export const importFile: <T = unknown>(url: string) => D9Command<T> = commands.importFile;

// ─── Presets ────────────────────────────────────────────────────────────────
export const readPresets: <T = unknown>() => D9Command<T> = commands.readPresets;
export const createPreset: <T = unknown>(data: Record<string, unknown>) => D9Command<T> = commands.createPreset;
export const updatePreset: <T = unknown>(id: string | number, data: Record<string, unknown>) => D9Command<T> = commands.updatePreset;
export const deletePreset: <T = unknown>(id: string | number) => D9Command<T> = commands.deletePreset;

// ─── Activity ───────────────────────────────────────────────────────────────
export const readActivity: <T = unknown>() => D9Command<T> = commands.readActivity;

// ─── Folders ────────────────────────────────────────────────────────────────
export const readFolders: <T = unknown>() => D9Command<T> = commands.readFolders;

// ─── Notifications ──────────────────────────────────────────────────────────
export const readNotifications: <T = unknown>(query?: Record<string, unknown>) => D9Command<T> = commands.readNotifications;

// ─── Revisions ──────────────────────────────────────────────────────────────
export const readRevisions: <T = unknown>(query?: Record<string, unknown>) => D9Command<T> = commands.readRevisions;

// ─── Shares ─────────────────────────────────────────────────────────────────
export const readShares: <T = unknown>(query?: Record<string, unknown>) => D9Command<T> = commands.readShares;

// ─── Providers ──────────────────────────────────────────────────────────────
export const readProviders: <T = unknown>() => D9Command<T> = commands.readProviders;

// ─── createDirectus (the key factory function) ──────────────────────────────
//
// In the original SDK:
//   createDirectus(url).with(authentication(...)).with(rest(...))
//
// In D9 compat, we just create our D9Client directly.
//
// The `auth` and `rest` middleware calls are silently ignored / replaced.
export function createDirectus(url: string) {
  // Return a builder-like object that supports .with() (no-ops)
  // but the actual client is only created when we need it.
  let authOptions: Record<string, any> = {};

  const builder = {
    with: (middleware: any) => {
      if (typeof middleware === "function") {
        const result = middleware({});
        if (result && typeof result === "object") {
          Object.assign(authOptions, result);
        }
      }
      return builder;
    },
    // The D9 client methods
    url: { origin: url.replace(/\/+$/, "") },
    request: async <T>(cmd: D9Command<T>): Promise<T> => {
      throw new Error("D9 compat: createDirectus().request() requires a storage to be configured. Use createD9Client() directly or set up the AuthContext properly.");
    },
    login: async (email: string, password: string) => {
      throw new Error("D9 compat: createDirectus().login() requires a storage. Use createD9Client().");
    },
    refresh: async () => {
      throw new Error("D9 compat: createDirectus().refresh() requires a storage. Use createD9Client().");
    },
    logout: async () => {
      throw new Error("D9 compat: createDirectus().logout() requires a storage. Use createD9Client().");
    },
    setToken: async (token: string) => {
      throw new Error("D9 compat: createDirectus().setToken() requires a storage. Use createD9Client().");
    },
    getToken: async (): Promise<string | null> => {
      return null;
    },
  };
  return builder;
}