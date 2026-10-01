/**
 * compat9/installWidgetSchemaD9.ts
 *
 * D9-compatible widget schema installer.
 * In D9, permissions are role-based (no policies), and the
 * directus_permissions table uses "role" UUIDs instead of "policy".
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { commands } from "@/compat9";
import {
  APP_WIDGET_CONFIG_COLLECTION,
  APP_WIDGET_FLOW_NAME,
  APP_WIDGET_FLOW_VERSION,
  APP_WIDGET_SUPPORTED,
  APP_WIDGET_TYPES,
  WIDGET_FLOW_OPERATION_TYPES,
} from "@/constants/widget";

const WIDGET_FIELDS: Array<{
  field: string;
  type: string;
  meta: Record<string, unknown>;
}> = [
  {
    field: "id",
    type: "uuid",
    meta: {
      special: ["uuid"],
      hidden:true,
      required: true,
      primary_key: true,
      note: "Primary key (UUID, auto-generated).",
    },
  },
  {
    field: "type",
    type: "string",
    meta: {
      interface: "select-dropdown",
      options: {
        choices: APP_WIDGET_TYPES.map((t) => ({ text: t.label, value: t.value })),
      },
      required: true,
      note: "Widget type. Currently only 'latest-items' is supported.",
    },
  },
  {
    field: "user_id",
    type: "uuid",
    meta: {
      interface: "select-dropdown-m2o",
      special: ["directus_users"],
      required: true,
      note: "Owner of this widget config (set by app; used for per-user widgets).",
    },
  },
  {
    field: "collection",
    type: "string",
    meta: { interface: "input", required: true },
  },
  {
    field: "title",
    type: "string",
    meta: {
      interface: "input",
      required: false,
      note: "Optional display title for the widget (shown in the widget header).",
    },
  },
  {
    field: "extra",
    type: "json",
    meta: {
      interface: "input-code",
      options: { language: "json" },
      note: "Fields/slots array for the widget query (e.g. [\"id\",\"title\"]).",
    },
  },
  {
    field: "filter",
    type: "json",
    meta: {
      interface: "input-code",
      options: { language: "json" },
      note: "Optional filter for the widget query.",
    },
  },
  {
    field: "sort",
    type: "string",
    meta: {
      interface: "input",
      note: "Directus sort string, e.g. -date_updated.",
    },
  },
  {
    field: "limit",
    type: "integer",
    meta: {
      interface: "input",
      note: "Limit for the widget query.",
    },
  },
];

export function useInstallWidgetSchemaD9() {
  const { directus } = useAuth();
  const queryClient = useQueryClient();

  const WIDGET_POLICY_NAME = "App widgets (create, read, update, delete own)";
  const log = (...args: any[]) => {
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.log("[widget-install-d9]", ...args);
    }
  };

  return useMutation({
    mutationFn: async () => {
      if (!directus) throw new Error("Not authenticated");

      const [collections, flowsRaw] = await Promise.all([
        directus.request(commands.readCollections()),
        directus.request(commands.readFlows({
          filter: { name: { _eq: APP_WIDGET_FLOW_NAME } },
          limit: 1,
        } as any)),
      ]);

      const collectionExists = Array.isArray(collections)
        ? collections.some(
            (c: { collection?: string }) =>
              c.collection === APP_WIDGET_CONFIG_COLLECTION,
          )
        : false;

      const flowsList = Array.isArray(flowsRaw)
        ? flowsRaw
        : ((flowsRaw as { data?: unknown[] })?.data ?? []);
      const flowExists = flowsList.length > 0;
      const existingFlowId: string | null =
        flowExists
          ? ((flowsList[0] as any)?.id ??
            (flowsList[0] as any)?.data?.id ?? null)
          : null;
      const existingFlowOperationId: string | null =
        flowExists ? ((flowsList[0] as any)?.operation ?? null) : null;

      log("collectionExists", collectionExists);
      log("flowExists", flowExists);

      let createdCollection = false;
      let createdFlowId: string | null = null;
      const opTypes = WIDGET_FLOW_OPERATION_TYPES;

      const idOf = (op: any): string | null =>
        (op as { id?: string })?.id ??
        (op as { data?: { id?: string } })?.data?.id ??
        null;

      const createCanonicalFlowOperations = async (flowId: string) => {
        log("createCanonicalFlowOperations", flowId);

        const opHandshake = await directus.request(
          commands.createOperation({
            flow: flowId,
            key: "handshake",
            type: opTypes.runScript,
            name: "Handshake (version + supports)",
            position_x: 60,
            position_y: -80,
            resolve: null,
            options: {
              code: `
module.exports = async function () {
  return {
    ok: true,
    status: "handshake",
    version: ${APP_WIDGET_FLOW_VERSION},
    supports: ${JSON.stringify(APP_WIDGET_SUPPORTED)},
  };
};`.trim(),
            },
          } as any),
        );
        const handshakeId = idOf(opHandshake);
        if (!handshakeId) throw new Error("Handshake operation created but no id");
        log("created op", "handshake", handshakeId);

        // Empty response for invalid/missing widget config
        const opEmptyResponse = await directus.request(
          commands.createOperation({
            flow: flowId,
            key: "empty_response",
            type: opTypes.runScript,
            name: "Empty response",
            position_x: 100,
            position_y: -80,
            resolve: null,
            options: {
              code: `
module.exports = async function (data) {
  const widgetId = data?.extract_query?.widget_id ?? null;
  const reason = data?.extract_widget_config?.reason ?? null;
  return {
    ok: false,
    status: "not_found",
    version: ${APP_WIDGET_FLOW_VERSION},
    supports: ${JSON.stringify(APP_WIDGET_SUPPORTED)},
    data: [],
    error: {
      code: "WIDGET_NOT_FOUND",
      message: reason
        ? \`Widget config not usable (\${reason})\`
        : "Widget config not found or invalid.",
    },
    widget_id: widgetId,
  };
};`.trim(),
            },
          } as any),
        );
        const emptyResponseId = idOf(opEmptyResponse);
        if (!emptyResponseId) throw new Error("Empty response operation created but no id");

        // The filter_items op - D9 version: role-based (no policies)
        const opFilterItems = await directus.request(
          commands.createOperation({
            flow: flowId,
            key: "filter_items",
            type: opTypes.runScript,
            name: "Response (latest-items, permission filtered)",
            position_x: 80,
            position_y: 0,
            resolve: null,
            options: {
              code: `
module.exports = async function (data) {
  try {
    const version = ${APP_WIDGET_FLOW_VERSION};
    const supports = ${JSON.stringify(APP_WIDGET_SUPPORTED)};
    const widget = data?.extract_widget_config?.widget ?? ((data.widget_config && Array.isArray(data.widget_config.data))
      ? data.widget_config.data[0]
      : (Array.isArray(data.widget_config) ? data.widget_config[0] : data.widget_config));
    if (!widget || !widget.user_id || !widget.collection) {
      return {
        ok: false, status: "invalid_config", version, supports, data: [],
        error: { code: "INVALID_WIDGET_CONFIG", message: "Missing user_id or collection on widget config." },
      };
    }
    if (widget.type && !supports.includes(String(widget.type))) {
      return {
        ok: false, status: "invalid_config", version, supports, data: [],
        error: { code: "UNSUPPORTED_WIDGET_TYPE", message: "Unsupported widget type." },
      };
    }

  function getFieldValueString(value) {
    if (value == null) return "";
    if (Array.isArray(value)) return value.map(getFieldValueString).filter(Boolean).join(", ");
    if (typeof value === "object") { try { return JSON.stringify(value); } catch { return "[Object]"; } }
    return String(value);
  }

  function getValuesAtPath(obj, path) {
    if (obj == null || !path) return [];
    var segments = String(path).split(".").filter(Boolean);
    if (segments.length === 0) return [obj];
    var key = segments[0];
    var rest = segments.slice(1);
    var restPath = rest.join(".");
    var val = (obj && typeof obj === "object" && key in obj) ? obj[key] : undefined;
    if (rest.length === 0) return val != null ? [val] : [];
    if (Array.isArray(val)) { var out = []; for (var i = 0; i < val.length; i++) { out = out.concat(getValuesAtPath(val[i], restPath)); } return out; }
    return getValuesAtPath(val, restPath);
  }

  function toM2AReadPath(path) {
    var parts = String(path).split(".");
    if (parts.length < 4) return path;
    return parts.slice(0, 2).concat(parts.slice(3)).join(".");
  }

  function getJoinedLeafValuesAtPath(obj, path) {
    if (!obj || !path) return "";
    var normalized = String(path).replace(/(\\w+):/g, "$1.");
    var values = getValuesAtPath(obj, normalized);
    var flat = Array.isArray(values) ? values : [values];
    var leaf = flat.filter(function (v) { return v != null && typeof v !== "object"; });
    if (leaf.length === 0 && normalized.split(".").filter(Boolean).length >= 4) {
      values = getValuesAtPath(obj, toM2AReadPath(normalized));
      flat = Array.isArray(values) ? values : [values];
      leaf = flat.filter(function (v) { return v != null && typeof v !== "object"; });
    }
    return leaf.map(getFieldValueString).filter(Boolean).join(", ");
  }

  function defaultSlotOptionsByKey(slotKey) {
    if (slotKey === "left" || slotKey === "right") {
      return { widthBehaviour: "fit", width: 24 };
    }
    return null;
  }

  var SLOT_OPTION_KEYS = { widthBehaviour: true, width: true };

  function mergeSlotOptions(slotKey, rawOpts) {
    var def = defaultSlotOptionsByKey(slotKey);
    if (!def) return null;
    var out = {};
    for (var dk in def) { if (Object.prototype.hasOwnProperty.call(def, dk)) out[dk] = def[dk]; }
    if (rawOpts && typeof rawOpts === "object" && !Array.isArray(rawOpts)) {
      var wb = rawOpts.widthBehaviour;
      if (wb === "stretch" || rawOpts.stretch === true) { out.widthBehaviour = "fixed"; }
      else if (wb === "fit" || wb === "fixed") { out.widthBehaviour = wb; }
      for (var rk in rawOpts) {
        if (!Object.prototype.hasOwnProperty.call(rawOpts, rk)) continue;
        if (!SLOT_OPTION_KEYS[rk]) continue;
        out[rk] = rawOpts[rk];
      }
      if (out.widthBehaviour !== "fit" && out.widthBehaviour !== "fixed") { out.widthBehaviour = "fixed"; }
      if (out.widthBehaviour === "stretch") out.widthBehaviour = "fixed";
    }
    delete out.stretch;
    return out;
  }

  function normalizeSlots(extra) {
    var defaults = [
      { key: "left", label: "Left", field: "" },
      { key: "title", label: "Title", field: "" },
      { key: "subtitle", label: "Subtitle", field: "" },
      { key: "right", label: "Right", field: "" },
    ];
    var raw = extra && extra.slots && Array.isArray(extra.slots) ? extra.slots : [];
    var byKey = {};
    for (var i = 0; i < raw.length; i++) {
      var s = raw[i];
      if (!s || typeof s !== "object") continue;
      var k = s.key != null ? String(s.key) : "";
      if (!k) continue;
      byKey[k] = {
        key: k, label: s.label != null ? String(s.label) : k,
        field: s.field != null ? String(s.field) : "",
        options: s.options != null && typeof s.options === "object" && !Array.isArray(s.options) ? s.options : null,
      };
    }
    return defaults.map(function (d) {
      var base = byKey[d.key] || d;
      var merged = mergeSlotOptions(base.key, base.options);
      var row = { key: base.key, label: base.label, field: base.field };
      if (merged) row.options = merged;
      return row;
    });
  }

  function asArray(val) {
    if (Array.isArray(val)) return val;
    if (val && typeof val === "object" && Array.isArray(val.data)) return val.data;
    return [];
  }

  const collection = widget.collection;
  const permissions = asArray(data.read_permissions);
  const roles = asArray(data.read_roles);
  const users = asArray(data.read_users);
  const items = asArray(data.read_collection);
  const relations = asArray(data.read_relations);
  const fieldsMeta = asArray(data.read_fields);
  const debugEnabled = !!(data && data.extract_query && (String(data.extract_query.debug || "").trim() === "1"));
  function debugLog(obj) { if (!debugEnabled) return; if (!data.__debug) data.__debug = {}; for (var k in obj) data.__debug[k] = obj[k]; }
  debugLog({ counts: { permissions: permissions.length, roles: roles.length, users: users.length, items: items.length } });

  // D9: permissions have "role" (UUID) instead of "policy"
  // Roles have "admin_access" directly (no policies)
  var adminRoleIds = new Set(
    roles.filter(function(r) { return r && r.admin_access; }).map(function(r) { return r.id; }).filter(Boolean)
  );

  // Get role IDs that have explicit "read" permissions on this collection
  var roleIdsFromPermissions = new Set(
    permissions
      .filter(function(p) { return p && p.collection === collection && p.action === "read"; })
      .map(function(p) { return p.role; })
      .filter(Boolean)
      .map(function(id) { return String(id); })
  );

  var roleIdsWithAccess = new Set(
    Array.from(adminRoleIds).concat(Array.from(roleIdsFromPermissions))
  );

  function userHasAccess(u) {
    return u.role && roleIdsWithAccess.has(String(u.role));
  }

  function userActive(u) {
    var s = u.status;
    if (s == null) return true;
    return String(s).toLowerCase() === "active";
  }

  var userIds = new Set(
    users
      .filter(function(u) { return userActive(u) && userHasAccess(u); })
      .map(function(u) { return u.id; })
      .filter(Boolean)
  );

  if (!userIds.has(widget.user_id)) {
    return {
      ok: false, status: "forbidden", version, supports, data: [],
      error: { code: "FORBIDDEN", message: "Widget owner does not have read access to this collection." },
    };
  }

  // ─── Per-slot value resolver ──
  function resolveSlotValue(it, slotField) {
    var path = String(slotField || "").trim();
    if (!path) return "";
    return getJoinedLeafValuesAtPath(it, path) || "";
  }

  function formatItemsForType(widgetType, rawExtra) {
    switch (widgetType) {
      case "latest-items":
      default: {
        var slots = normalizeSlots(rawExtra || {});
        var formatted = (Array.isArray(items) ? items : []).map(function (it) {
          var id = it && (it.id != null ? String(it.id) : "");
          var values = slots.reduce(function (acc, s) {
            var field = (s && s.field != null) ? String(s.field) : "";
            if (!field.trim()) return acc;
            var row = {
              slot: s.key,
              type: "string",
              value: resolveSlotValue(it, field),
            };
            if (s.options && typeof s.options === "object" && (s.key === "left" || s.key === "right")) {
              row.options = s.options;
            }
            acc.push(row);
            return acc;
          }, []);
          return { id: id, values: values };
        });
        return [{ type: "latest-items", items: formatted }];
      }
    }
  }

  var widgetType = widget.type != null ? String(widget.type) : "latest-items";
  var responseData = formatItemsForType(widgetType, widget.extra || {});

  var resp = { ok: true, status: "ok", version, supports, data: responseData };
  if (debugEnabled) resp.debug = data.__debug || { enabled: true };
  return resp;
  } catch (e) {
    return {
      ok: false, status: "error", version, supports, data: [],
      error: { code: "FLOW_ERROR", message: e && e.message ? String(e.message) : String(e) },
    };
  }
};`.trim(),
            },
          } as any),
        );
        const filterItemsId = idOf(opFilterItems);
        if (!filterItemsId) throw new Error("Filter items operation created but no id");

        // Read the target collection items
        const opReadCollection = await directus.request(
          commands.createOperation({
            flow: flowId,
            key: "read_collection",
            type: opTypes.readData,
            name: "Read collection",
            position_x: 60,
            position_y: 0,
            resolve: filterItemsId,
            options: {
              collection: "{{ extract_widget_config.widget.collection }}",
              permissions: "$full",
              emitEvents: false,
              query: {
                limit: 10,
                sort: "{{ extract_widget_config.widget.sort }}",
                filter: "{{ extract_widget_config.widget.filter_json }}",
                fields: "{{ extract_widget_config.widget.fields_csv }}",
              },
            },
          } as any),
        );
        const readCollectionId = idOf(opReadCollection);
        if (!readCollectionId) throw new Error("Read collection op created but no id");

        const opReadUsers = await directus.request(
          commands.createOperation({
            flow: flowId,
            key: "read_users",
            type: opTypes.readData,
            name: "Read users",
            position_x: 40,
            position_y: 0,
            resolve: readCollectionId,
            options: {
              collection: "directus_users",
              permissions: "$full",
              emitEvents: false,
              query: { limit: -1, fields: ["id", "role", "status"] },
            },
          } as any),
        );
        const readUsersId = idOf(opReadUsers);
        if (!readUsersId) throw new Error("Read users operation created but no id");

        const opReadRoles = await directus.request(
          commands.createOperation({
            flow: flowId,
            key: "read_roles",
            type: opTypes.readData,
            name: "Read roles",
            position_x: 30,
            position_y: 0,
            resolve: readUsersId,
            options: {
              collection: "directus_roles",
              permissions: "$full",
              emitEvents: false,
              query: { limit: -1, fields: ["id", "admin_access"] },
            },
          } as any),
        );
        const readRolesId = idOf(opReadRoles);
        if (!readRolesId) throw new Error("Read roles operation created but no id");

        // D9: directus_permissions has "role" field instead of "policy"
        const opReadPermissions = await directus.request(
          commands.createOperation({
            flow: flowId,
            key: "read_permissions",
            type: opTypes.readData,
            name: "Read permissions",
            position_x: 10,
            position_y: 0,
            resolve: readRolesId,
            options: {
              collection: "directus_permissions",
              permissions: "$full",
              emitEvents: false,
              query: { limit: -1, fields: ["collection", "role", "action", "fields"] },
            },
          } as any),
        );
        const readPermissionsId = idOf(opReadPermissions);
        if (!readPermissionsId) throw new Error("Read permissions operation created but no id");

        const opReadRelations = await directus.request(
          commands.createOperation({
            flow: flowId,
            key: "read_relations",
            type: opTypes.readData,
            name: "Read relations",
            position_x: 0,
            position_y: 0,
            resolve: readPermissionsId,
            options: {
              collection: "directus_relations",
              permissions: "$full",
              emitEvents: false,
              query: { limit: -1, fields: ["id", "many_collection", "many_field", "one_collection", "one_field", "junction_field", "sort_field"] },
            },
          } as any),
        );
        const readRelationsId = idOf(opReadRelations);
        if (!readRelationsId) throw new Error("Read relations operation created but no id");

        const opReadFieldsMeta = await directus.request(
          commands.createOperation({
            flow: flowId,
            key: "read_fields",
            type: opTypes.readData,
            name: "Read fields meta",
            position_x: -10,
            position_y: 0,
            resolve: readRelationsId,
            options: {
              collection: "directus_fields",
              permissions: "$full",
              emitEvents: false,
              query: { limit: -1, fields: ["collection", "field", "meta", "type", "special", "interface"] },
            },
          } as any),
        );
        const readFieldsMetaId = idOf(opReadFieldsMeta);
        if (!readFieldsMetaId) throw new Error("Read fields meta operation created but no id");

        const opReadWidgetConfig = await directus.request(
          commands.createOperation({
            flow: flowId,
            key: "widget_config",
            type: opTypes.readData,
            name: "Read widget config",
            position_x: 150,
            position_y: 0,
            resolve: readFieldsMetaId,
            options: {
              collection: APP_WIDGET_CONFIG_COLLECTION,
              permissions: "$full",
              emitEvents: false,
              query: {
                limit: 1,
                filter: { id: { _eq: "{{ extract_query.widget_id }}" } },
              },
            },
          } as any),
        );
        const widgetConfigId = idOf(opReadWidgetConfig);
        if (!widgetConfigId) throw new Error("Widget config operation created but no id");

        // Extract query params
        const opExtractQuery = await directus.request(
          commands.createOperation({
            flow: flowId,
            key: "extract_query",
            type: opTypes.runScript,
            name: "Extract query params",
            position_x: 140,
            position_y: 0,
            resolve: widgetConfigId,
            options: {
              code: `
module.exports = async function(data) {
  var trigger = (data && data.$trigger) ? data.$trigger : {};
  var query = (trigger && trigger.query) ? trigger.query : {};
  var widget_id = query.widget_id ? String(query.widget_id).trim().toLowerCase() : "";
  var debug = query.debug ? String(query.debug).trim() : "";
  return { widget_id: widget_id, debug: debug };
};`.trim(),
            },
          } as any),
        );
        const extractQueryId = idOf(opExtractQuery);
        if (!extractQueryId) throw new Error("Extract query operation created but no id");

        // Extract and validate widget config
        const opExtractWidgetConfig = await directus.request(
          commands.createOperation({
            flow: flowId,
            key: "extract_widget_config",
            type: opTypes.runScript,
            name: "Extract & validate widget config",
            position_x: 130,
            position_y: 0,
            resolve: extractQueryId,
            options: {
              code: `
module.exports = async function(data) {
  var widgetList = data.widget_config;
  if (!widgetList) return { reason: "no_widget_config_data" };
  var items = Array.isArray(widgetList) ? widgetList : (widgetList.data || [widgetList]);
  var w = items[0];
  if (!w) return { reason: "no_widget_found" };
  var sort = w.sort && String(w.sort).trim() ? String(w.sort).trim() : "-date_updated";
  var fields = (w.extra && w.extra.fields) ? w.extra.fields : [];
  var limit = w.limit || 10;
  var filterObj = (w.extra && w.extra.filter) ? w.extra.filter : (w.filter || null);
  var fields_csv = Array.isArray(fields) ? fields.join(",") : "id";
  var filter_json = filterObj ? JSON.stringify(filterObj) : "{}";
  var slots = (w.extra && w.extra.slots) ? w.extra.slots : [];
  return {
    widget: {
      id: w.id, type: w.type, user_id: w.user_id,
      collection: w.collection, sort: sort, limit: limit,
      fields_csv: fields_csv, filter_json: filter_json,
      extra: { slots: slots, fields: fields, filter: filterObj },
    }
  };
};`.trim(),
            },
          } as any),
        );
        const extractWidgetConfigId = idOf(opExtractWidgetConfig);
        if (!extractWidgetConfigId) throw new Error("Extract widget config operation created but no id");

        // Wire flows: extract_query -> extract_widget_config -> handshake branching
        await directus.request(
          commands.updateFlow(flowId, { operation: handshakeId } as any)
        );
      };

      try {
        if (!collectionExists) {
          await directus.request(
            commands.createCollection({
              collection: APP_WIDGET_CONFIG_COLLECTION,
              meta: {
                icon: "dashboard",
                note: "Widget configs for mobile app home screen",
                hidden: false,
              },
              schema: { name: APP_WIDGET_CONFIG_COLLECTION },
            } as any)
          );
          createdCollection = true;
          for (const f of WIDGET_FIELDS) {
            await directus.request(
              commands.createField(APP_WIDGET_CONFIG_COLLECTION, {
                field: f.field,
                type: f.type,
                meta: f.meta,
              } as any)
            );
          }
        }

        if (!flowExists) {
          const flow = await directus.request(
            commands.createFlow({
              name: APP_WIDGET_FLOW_NAME,
              icon: "dashboard",
              description: "Webhook flow for mobile app home screen widgets (D9 compatible).",
              status: "active",
              trigger: "webhook",
              options: {
                method: "GET",
              },
            } as any)
          );
          createdFlowId =
            (flow as { id?: string })?.id ??
            (flow as { data?: { id?: string } })?.data?.id;
          if (!createdFlowId) throw new Error("Flow created but no id returned");

          await createCanonicalFlowOperations(createdFlowId);
        }

      } catch (error) {
        try {
          if (createdFlowId) {
            await directus.request(commands.deleteFlow(createdFlowId));
          }
        } catch { }
        try {
          if (createdCollection) {
            await directus.request(commands.deleteCollection(APP_WIDGET_CONFIG_COLLECTION));
          }
        } catch { }

        throw error;
      }

      await queryClient.invalidateQueries({ queryKey: ["widgetCollectionExists"] });
      await queryClient.invalidateQueries({ queryKey: ["collections"] });
      return { installed: true };
    },
  });
}