/**
 * compat9/installPushSchemaD9.ts
 *
 * D9-compatible version of installPushSchema that:
 * - Uses directus_permissions (role_id-based, not policy_id-based)
 * - Doesn't reference directus_policies
 * - Uses role-based permission checking
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { commands } from "@/compat9";
import Constants from "expo-constants";
import {
  APP_PUSH_DEVICES_COLLECTION,
  APP_PUSH_FLOW_NAME,
  PUSH_ENDPOINT_URL,
  PUSH_FLOW_OPERATION_TYPES,
} from "@/constants/push";

function getPushSecret(): string | undefined {
  return (Constants.expoConfig as { extra?: { pushSecret?: string } })?.extra
    ?.pushSecret;
}

const PUSH_FIELDS: Array<{
  field: string;
  type: string;
  meta: Record<string, unknown>;
}> = [
  {
    field: "token",
    type: "string",
    meta: { interface: "input", required: true },
  },
  {
    field: "platform",
    type: "string",
    meta: { interface: "select-dropdown", options: { choices: [{ text: "iOS", value: "ios" }, { text: "Android", value: "android" }] } },
  },
  {
    field: "subscriptions",
    type: "json",
    meta: { interface: "input-code", options: { language: "json" } },
  },
  {
    field: "user_id",
    type: "uuid",
    meta: {
      interface: "select-dropdown-m2o",
      special: ["directus_users"],
      required: true,
      note: "Owner of this device (set by app; used for multi-user per server).",
    },
  },
];

/**
 * D9-compatible push schema installer.
 * In D9, there are no "policies". Permissions are stored in directus_permissions
 * linked to roles directly. This installer creates the collection and flow,
 * but skips the policies part since D9 uses a different permission model.
 */
export function useInstallPushSchemaD9() {
  const { directus } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!directus) throw new Error("Not authenticated");
      const [collections, flowsRaw] = await Promise.all([
        directus.request(commands.readCollections()),
        directus.request(commands.readFlows({ filter: { name: { _eq: APP_PUSH_FLOW_NAME } }, limit: 1 } as any)),
      ]);
      const collectionExists = Array.isArray(collections)
        ? collections.some(
          (c: { collection?: string }) =>
            c.collection === APP_PUSH_DEVICES_COLLECTION
        )
        : false;
      const allCollections = Array.isArray(collections)
        ? (collections as { collection?: string }[])
          .map((c) => c.collection)
          .filter(
            (name): name is string =>
              typeof name === "string" && !name.startsWith("directus_")
          )
        : [];
      const flowsList = Array.isArray(flowsRaw) ? flowsRaw : (flowsRaw as { data?: unknown[] })?.data ?? [];
      const flowExists = flowsList.length > 0;
      if (collectionExists && flowExists)
        return { installed: false, alreadyExists: true };

      let createdCollection = false;
      let createdFlowId: string | null = null;

      try {
        if (!collectionExists) {
          await directus.request(
            commands.createCollection({
              collection: APP_PUSH_DEVICES_COLLECTION,
              meta: {
                icon: "notifications",
                note: "Push device tokens for custom push endpoint",
                hidden: false,
              },
              schema: { name: APP_PUSH_DEVICES_COLLECTION },
            } as any)
          );
          createdCollection = true;
          for (const f of PUSH_FIELDS) {
            await directus.request(
              commands.createField(APP_PUSH_DEVICES_COLLECTION, {
                field: f.field,
                type: f.type,
                meta: f.meta,
              } as any)
            );
          }
        }

        if (!flowExists) {
          const pushSecret = getPushSecret();
          if (!pushSecret?.trim()) {
            throw new Error(
              "Push secret is not set. Add PUSH_SECRET (or EXPO_PUBLIC_PUSH_SECRET) in .env or EAS Secrets. See README or app.config.js."
            );
          }

          const flow = await directus.request(
            commands.createFlow({
              name: APP_PUSH_FLOW_NAME,
              icon: "notifications",
              description:
                "Reads app_push_devices, filters by trigger collection/action and user access, sends token list to push endpoint.",
              status: "active",
              trigger: "event",
              options: {
                type: "action",
                scope: ["items.create", "items.update", "items.delete"],
                collections: allCollections,
              },
            } as any)
          );
          const flowId =
            (flow as { id?: string })?.id ??
            (flow as { data?: { id?: string } })?.data?.id;
          if (!flowId) throw new Error("Flow created but no id returned");
          createdFlowId = flowId;

          const opTypes = PUSH_FLOW_OPERATION_TYPES;

          // D9-compatible filter script — uses role-based permission checking (no policies)
          const requestBody =
            '{"collection":"{{ $trigger.collection }}","event":"{{ $trigger.event }}","key":"{{ $trigger.key }}",' +
            '"payload":{"title":"Item {{ $trigger.event }}","body":"{{ $trigger.collection }} #{{ $trigger.key }}"},"tokens":{{ filter_tokens }}}';

          const opRequest = await directus.request(
            commands.createOperation({
              flow: flowId,
              key: "send-push-request",
              type: opTypes.request,
              name: "Send to push endpoint",
              position_x: 120,
              position_y: 0,
              options: {
                url: PUSH_ENDPOINT_URL,
                method: "POST",
                headers: [
                  { header: "Content-Type", value: "application/json" },
                  {
                    header: "Authorization",
                    value: `Bearer ${pushSecret.trim()}`,
                  },
                ],
                body: requestBody,
              },
            } as any)
          );
          const opRequestId =
            (opRequest as { id?: string })?.id ??
            (opRequest as { data?: { id?: string } })?.data?.id;
          if (!opRequestId) throw new Error("Request operation created but no id");

          // D9-compatible filter script: directus_permissions have `role` (not `policy` field)
          const filterScriptCode = `
module.exports = async function(data) {
  const trigger = (data && data.$trigger) ? data.$trigger : {};
  const collection = trigger.collection || '';
  const action = (trigger.event || '').split('.').pop() || '';

  function asArray(val) {
    if (Array.isArray(val)) return val;
    if (val && typeof val === 'object' && Array.isArray(val.data)) return val.data;
    return [];
  }
  const permissions = asArray(data.read_permissions);
  const roles = asArray(data.read_roles);
  const users = asArray(data.read_users);
  const devices = asArray(data.read_devices);

  // D9: permissions have a "role" field (UUID) instead of "policy" field
  var adminRoleIds = new Set(
    roles.filter(function(r) { return r && r.admin_access; }).map(function(r) { return r.id; }).filter(Boolean)
  );

  // Permissions are linked to roles directly (no policies indirection)
  var roleIdsFromPermissions = new Set(
    permissions
      .filter(function(p) { return p && p.collection === collection && p.action === action; })
      .map(function(p) { return p.role; })
      .filter(Boolean)
      .map(function(id) { return String(id); })
  );

  var roleIdsWithAccess = new Set(
    Array.from(adminRoleIds).concat(Array.from(roleIdsFromPermissions))
  );

  var userIds = new Set(
    users
      .filter(function(u) {
        var s = u.status;
        if (s == null) return true;
        return String(s).toLowerCase() === 'active';
      })
      .filter(function(u) { return u.role && roleIdsWithAccess.has(String(u.role)); })
      .map(function(u) { return u.id; })
      .filter(Boolean)
  );

  const out = [];
  for (var i = 0; i < devices.length; i++) {
    var d = devices[i];
    if (d.user_id && !userIds.has(d.user_id)) continue;
    var subs = d.subscriptions;
    if (!Array.isArray(subs)) continue;
    var entry = subs.find(function(s) { return s && s.collection === collection; });
    if (!entry || !entry[action]) continue;
    var token = d.token && String(d.token).trim();
    if (token && (d.platform === 'ios' || d.platform === 'android')) {
      out.push({ token: token, platform: d.platform });
    }
  }
  return out;
};
`.trim();

          const opScript = await directus.request(
            commands.createOperation({
              flow: flowId,
              key: "filter_tokens",
              type: opTypes.runScript,
              name: "Filter tokens by access and subscription",
              position_x: 100,
              position_y: 0,
              resolve: opRequestId,
              options: { code: filterScriptCode },
            } as any)
          );
          const opScriptId =
            (opScript as { id?: string })?.id ??
            (opScript as { data?: { id?: string } })?.data?.id;
          if (!opScriptId) throw new Error("Script operation created but no id");

          const opReadDevices = await directus.request(
            commands.createOperation({
              flow: flowId,
              key: "read_devices",
              type: opTypes.readData,
              name: "Read push devices",
              position_x: 60,
              position_y: 0,
              resolve: opScriptId,
              options: {
                collection: APP_PUSH_DEVICES_COLLECTION,
                permissions: "$full",
                emitEvents: false,
                query: { limit: -1, fields: ["token", "platform", "subscriptions", "user_id"] },
              },
            } as any)
          );
          const opReadDevicesId =
            (opReadDevices as { id?: string })?.id ??
            (opReadDevices as { data?: { id?: string } })?.data?.id;
          if (!opReadDevicesId) throw new Error("Read devices operation created but no id");

          const opReadUsers = await directus.request(
            commands.createOperation({
              flow: flowId,
              key: "read_users",
              type: opTypes.readData,
              name: "Read users",
              position_x: 40,
              position_y: 0,
              resolve: opReadDevicesId,
              options: {
                collection: "directus_users",
                permissions: "$full",
                emitEvents: false,
                query: { limit: -1, fields: ["id", "role", "status"] },
              },
            } as any)
          );
          const opReadUsersId =
            (opReadUsers as { id?: string })?.id ??
            (opReadUsers as { data?: { id?: string } })?.data?.id;
          if (!opReadUsersId) throw new Error("Read users operation created but no id");

          const opReadRoles = await directus.request(
            commands.createOperation({
              flow: flowId,
              key: "read_roles",
              type: opTypes.readData,
              name: "Read roles",
              position_x: 20,
              position_y: 0,
              resolve: opReadUsersId,
              options: {
                collection: "directus_roles",
                permissions: "$full",
                emitEvents: false,
                query: { limit: -1, fields: ["id", "admin_access"] },
              },
            } as any)
          );
          const opReadRolesId =
            (opReadRoles as { id?: string })?.id ??
            (opReadRoles as { data?: { id?: string } })?.data?.id;
          if (!opReadRolesId) throw new Error("Read roles operation created but no id");

          // D9: directus_permissions has "role" field (not "policy" field)
          const opReadPermissions = await directus.request(
            commands.createOperation({
              flow: flowId,
              key: "read_permissions",
              type: opTypes.readData,
              name: "Read permissions",
              position_x: 0,
              position_y: 0,
              resolve: opReadRolesId,
              options: {
                collection: "directus_permissions",
                permissions: "$full",
                emitEvents: false,
                query: { limit: -1, fields: ["collection", "role", "action"] },
              },
            } as any)
          );
          const opReadPermissionsId =
            (opReadPermissions as { id?: string })?.id ??
            (opReadPermissions as { data?: { id?: string } })?.data?.id;
          if (!opReadPermissionsId) throw new Error("Read permissions operation created but no id");

          await directus.request(
            commands.updateFlow(flowId, { operation: opReadPermissionsId } as any)
          );
        }

        // D9: Skip policy creation; permissions must be managed manually through the D9 admin panel.
        // The app_push_devices collection was created for users to manage their device tokens.

      } catch (error) {
        try {
          if (createdFlowId) {
            await directus.request(commands.deleteFlow(createdFlowId as any));
          }
        } catch { }
        try {
          if (createdCollection) {
            await directus.request(
              commands.deleteCollection(APP_PUSH_DEVICES_COLLECTION)
            );
          }
        } catch { }

        throw error;
      }

      await queryClient.invalidateQueries({ queryKey: ["pushCollectionExists"] });
      await queryClient.invalidateQueries({ queryKey: ["collections"] });
      await queryClient.invalidateQueries({ queryKey: ["roles"] });
      return { installed: true };
    },
  });
}