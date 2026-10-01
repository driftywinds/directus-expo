# D9 Compatibility Layer for Directus Expo

This branch (`d9-compat`) contains modifications to make the Directus Expo app work with **D9** (Directus 9/10 fork) servers.

## What is D9?

D9 is a maintained fork of Directus 9, available at [https://github.com/LaWebcapsule/d9](https://github.com/LaWebcapsule/d9). 
It keeps the Directus v9 API model while receiving ongoing updates. The API documentation is available in 
the `d9-docs/` directory.

## Key Differences: D9 vs Directus 10+

| Feature | Directus 10+ (SDK v18) | D9 (Directus 9 API) |
|---------|----------------------|---------------------|
| User roles | `policies` field (array) | `role` field (single UUID) |
| Permissions | `directus_policies` table | No policies table; permissions are in `directus_permissions` linked to `role` |
| Auth model | `/permissions/me` returns policy globals | No `/permissions/me`; use `/users/me` + `/roles/:id` |
| Permission field | `directus_permissions.policy` | `directus_permissions.role` |
| Admin access | `directus_policies.admin_access` | `directus_roles.admin_access` |

## Architecture of the Compatibility Layer

### 1. `compat9/directusClient.ts`
A lightweight fetch-based REST client that talks directly to the D9 API. 
It provides:
- `createD9Client(url, storage)` — factory function
- `D9Client` interface (login, refresh, logout, setToken, getToken, request)
- `commands` namespace with typed request builders for every D9 endpoint
- D9-style aggregation support

### 2. `compat9/shim.ts` 
A compatibility shim that re-exports everything originally imported from `@directus/sdk` 
but routes it through the D9 client. The tsconfig.json maps `@directus/sdk` → `compat9/shim.ts` 
so all existing imports continue to work without changes.

### 3. `compat9/installPushSchemaD9.ts`
D9-compatible version of the push notification schema installer that:
- Uses `directus_permissions.role` instead of `directus_permissions.policy`
- Does not reference `directus_policies`
- The flow script checks role-based access (admin role or matching permission)

### 4. `compat9/installWidgetSchemaD9.ts`
D9-compatible version of the widget schema installer with the same role-based approach.

## How it works

1. **AuthContext.tsx** uses `createD9Client()` instead of `createDirectus().with(authentication()).with(rest())`
2. **AuthContext derives policy globals** from the user's role (`/users/me` → get `role` → `/roles/:id` → get `admin_access`/`app_access`/`enforce_tfa`)
3. **All SDK imports** automatically resolve to the D9 shim via tsconfig path mapping
4. **Policy operations** (readPolicy, createPolicy, deletePolicy, etc.) are mapped to equivalent role operations
5. **Flow scripts** in push/widget installers use `directus_permissions.role` (v9 style) instead of `directus_permissions.policy` (v10+ style)

## Files Changed

| File | Change |
|------|--------|
| `tsconfig.json` | Added `@directus/sdk` → `compat9/shim.ts` path mapping |
| `contexts/AuthContext.tsx` | Rewritten to use `createD9Client()` and role-based permissions |
| `state/queries/directus/core.ts` | Updated to use `commands.*` instead of SDK wrappers |
| `state/queries/directus/collection.ts` | Updated to use D9-compatible types |
| `state/queries/directus/server.ts` | Updated to use D9 commands |
| `state/actions/*.ts` | All action files updated to use D9 commands |
| `compat9/directusClient.ts` | **New** — D9 REST client |
| `compat9/shim.ts` | **New** — SDK v18 → D9 compatibility shim |
| `compat9/installPushSchemaD9.ts` | **New** — D9 push installer |
| `compat9/installWidgetSchemaD9.ts` | **New** — D9 widget installer |
| `compat9/index.ts` | **New** — compat9 entry point |

## Known Limitations

1. **Static token sessions**: The `role` field is not available when authenticating with static tokens, 
   so admin/app access is assumed from the user's role property
2. **Permission creation**: D9 does not support creating policies programmatically. The push/widget 
   installers create collections and flows but skip automatic permission setup — an admin must 
   configure permissions manually through the D9 admin panel
3. **Flow widget inline scripts**: The `$CURRENT_USER` variable may not work identically in all D9 versions

## Testing

To test this branch:
1. Point the app at a D9 server URL
2. Log in with email/password or static token
3. Verify that collections, items, files, and settings load correctly
4. Test push notification and widget setup flows