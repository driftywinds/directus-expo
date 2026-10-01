import { useMutation, useQuery } from "@tanstack/react-query";
import {
  commands,
  createD9Client,
  type CoreSchema,
  type D9Client,
  type DirectusFile,
} from "@/compat9";
import { useAuth } from "@/contexts/AuthContext";
import { mutateUser } from "@/state/actions/updateUser";
import { mutateMe } from "@/state/actions/updateMe";
import { get, unset } from "lodash";
import { removeFile } from "@/state/actions/deleteFile";
import { removeFiles } from "@/state/actions/deleteFiles";
import { mutateFile } from "@/state/actions/updateFile";
import { addUsers } from "@/state/actions/addUsers";
import { API } from "@/components/APIForm";
import { addRole } from "@/state/actions/addRole";

export const useMe = () => {
  const { directus, user } = useAuth();
  return useQuery({
    queryKey: ["me", user?.id],
    queryFn: () => directus?.request(commands.readMe()),
  });
};

export const usePermissions = () => {
  const { directus, user } = useAuth();
  return useQuery({
    queryKey: ["permissions", user?.id],
    // D9: read /permissions for the current user's permission rows
    queryFn: () => directus?.request(commands.readPermissions()),
  });
};

export const useCollections = () => {
  const { directus, user } = useAuth();
  return useQuery({
    queryKey: ["collections", user?.id],
    queryFn: () => directus?.request(commands.readCollections()),
  });
};

export const useRelations = () => {
  const { directus, user } = useAuth();
  return useQuery({
    queryKey: ["relations", user?.id],
    queryFn: () => directus?.request(commands.readRelations()),
  });
};

export const useSettings = () => {
  const { directus, user } = useAuth();
  return useQuery({
    queryKey: ["settings", user?.id],
    queryFn: () => directus?.request(commands.readSettings()),
  });
};

export const useItemPermissions = (
  collection: string,
  docId?: number | string | "+"
) => {
  const { directus, user } = useAuth();
  return useQuery({
    queryKey: ["document-permissions", user?.id, collection, docId],
    queryFn: () =>
      directus?.request(
        commands.readPermissions() as any
      ),
  });
};

/**
 *
 * CORE COLLECTIONS
 *
 */

export const useUser = (id: string) => {
  const { directus } = useAuth();
  return useQuery({
    queryKey: ["user", id],
    queryFn: () => directus?.request(commands.readUser(id)),
  });
};

export const useUsers = (query?: any) => {
  const { directus, user } = useAuth();
  return useQuery({
    queryKey: ["users", user?.id, query],
    queryFn: async () => {
      const items = await directus?.request(commands.readUsers(query));
      return { items, total: 0 };
    },
  });
};

export const usePolicy = (id: string) => {
  // D9: policies are mapped to roles
  const { directus } = useAuth();
  return useQuery({
    queryKey: ["policy", id],
    queryFn: () => directus?.request(commands.readRole(id)),
  });
};

export const useRole = (id: string) => {
  const { directus } = useAuth();
  return useQuery({
    queryKey: ["role", id],
    queryFn: () => directus?.request(commands.readRole(id)),
  });
};

export const useRoles = (query?: any) => {
  const { directus, user } = useAuth();
  return useQuery({
    queryKey: ["roles", user?.id],
    queryFn: async () => {
      const items = await directus?.request(commands.readRoles(query));
      return { items, total: 0 };
    },
  });
};

export const usePolicies = (query?: any) => {
  // D9: policies are roles
  const { directus, user } = useAuth();
  return useQuery({
    queryKey: ["policies", user?.id],
    queryFn: async () => {
      const items = await directus?.request(commands.readRoles(query));
      return { items, total: 0 };
    },
  });
};

export const useProviders = (api?: API) => {
  return useQuery({
    queryKey: ["providers", api?.url],
    queryFn: async () => {
      const local = createD9Client(api?.url ?? "", {
        get: async () => null,
        set: async () => {},
        clear: async () => {},
      });
      const items = await local?.request(commands.readProviders());
      return { items, total: 0 };
    },
    enabled: !!api?.url,
  });
};

export const useFiles = (query?: any) => {
  const { directus, user } = useAuth();
  return useQuery({
    queryKey: ["files", user?.id, query],
    queryFn: async () => {
      const items = (await directus?.request(
        commands.readFiles(query)
      )) as unknown as DirectusFile[];
      const aggregateQuery = { ...(query ?? {}) };
      unset(aggregateQuery, ["page"]);
      const pagination = await directus?.request(
        commands.aggregate("directus_files", {
          aggregate: { count: "*" },
          query: aggregateQuery as any,
        })
      );
      return { items: items, total: Number(get(pagination, "0.count")) };
    },
  });
};

export const useFile = (id: string, query?: any) => {
  const { directus } = useAuth();
  return useQuery({
    queryKey: ["file", id, query],
    queryFn: () => directus?.request(commands.readFile(id)),
  });
};

const prefix = "directus_";

export const coreCollections: Record<string, any> = {
  [prefix + "users"]: {
    me: useMe,
    readItem: useUser,
    readItems: useUsers,
    createItems: addUsers,
    updateItem: mutateUser,
    updateMe: mutateMe,
    removeItem: (id: string) => {
      const { directus } = useAuth();
      return useMutation({
        mutationFn: () => directus!.request(commands.deleteUser(id)),
      });
    },
    removeItems: (ids: string[]) => {
      const { directus } = useAuth();
      return useMutation({
        mutationFn: () => directus!.request(commands.deleteUsers(ids)),
      });
    },
  },
  [prefix + "roles"]: {
    readItem: useRole,
    readItems: useRoles,
    createItem: addRole,
    removeItem: (id: string) => {
      const { directus } = useAuth();
      return useMutation({
        mutationFn: () => directus!.request(commands.deleteRole(id)),
      });
    },
    removeItems: (ids: string[]) => {
      const { directus } = useAuth();
      return useMutation({
        mutationFn: () => directus!.request(commands.deleteRoles(ids)),
      });
    },
  },
  // D9: no separate policies collection, map to roles
  [prefix + "policies"]: {
    readItem: usePolicy,
    readItems: usePolicies,
    removeItem: (id: string) => {
      const { directus } = useAuth();
      return useMutation({
        mutationFn: () => directus!.request(commands.deleteRole(id)),
      });
    },
  },
  [prefix + "files"]: {
    readItem: useFile,
    readItems: useFiles,
    removeItem: removeFile,
    removeItems: removeFiles,
    updateItem: mutateFile,
  },
  [prefix + "providers"]: {
    readItems: useProviders,
  },
  [prefix + "settings"]: {
    readItem: useSettings,
  },
};