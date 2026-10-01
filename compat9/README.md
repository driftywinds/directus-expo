# D9 Compatibility Layer

This directory contains the D9 (Directus 9/10) compatibility layer for the Directus Expo app.

## What changed

The original app uses `@directus/sdk` v18 which targets Directus 10+ with the **policies** model.
D9 uses a Directus 9-compatible API where:

- **Users** have a `role` field (not `policies`)
- **Roles** embed permissions directly (not through separate `policies`)
- No `/permissions/me` endpoint (policy globals)
- No `directus_policies` system collection
- **Flows/Operations** API is similar but uses v9-style endpoints
- **Server info/health** endpoints are compatible

## How to use

The exported module replaces `@directus/sdk` imports with lightweight fetch-based
implementations that talk to D9's REST API directly.